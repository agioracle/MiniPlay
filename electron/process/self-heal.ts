import { BrowserWindow } from 'electron';
import { runCoderAgent } from '../coder/coder-runner';
import { runH5Build } from './build-manager';
import { startVitePreview } from './vite-manager';
import { getActiveProject } from '../project/state';
import { parseBuildError, type ParsedError } from './error-parser';
import { coderSessionManager } from '../coder/session-manager';
import * as fs from 'fs';
import * as path from 'path';

const MAX_RETRIES = 3;

/**
 * Substrings that indicate the coder failure is NOT worth retrying within a
 * single self-heal session, because no amount of retries inside the same
 * process state can fix them (missing binary, auth, quota, etc.). Matched
 * case-insensitively against coderResult.error.
 */
const UNRECOVERABLE_ERROR_PATTERNS: readonly string[] = [
  'ENOENT',                // binary not found on PATH
  'not found',             // generic "... not found"
  'command not found',
  'permission denied',     // chmod / exec bit missing
  'EACCES',
  'unauthorized',          // 401
  'authentication',        // generic auth failure
  'invalid api key',
  'api key',
  'quota',                 // hit plan quota
  'rate limit',            // still worth noting; retrying immediately won't help
  'insufficient',          // "insufficient credits/balance"
];

/**
 * Normalize a coder error string into a short fingerprint so we can detect
 * "two consecutive attempts failed for the exact same reason" and bail early
 * instead of wasting the remaining retry budget.
 */
function errorFingerprint(err: string | undefined): string {
  if (!err) return '';
  return err
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // Strip volatile tokens (timestamps, hashes, PIDs, request-ids, paths)
    .replace(/\b\d{1,}\b/g, 'N')
    .replace(/\b[a-f0-9]{8,}\b/g, 'HEX')
    .replace(/(\/[^\s'"]+)/g, 'PATH')
    .trim()
    .slice(0, 200);
}

function isUnrecoverable(err: string | undefined): boolean {
  if (!err) return false;
  const lower = err.toLowerCase();
  return UNRECOVERABLE_ERROR_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Build a fix prompt from error context.
 */
function buildFixPrompt(errors: ParsedError[], projectPath: string): string {
  const gddPath = path.join(projectPath, 'docs', 'GDD.md');

  // Read source files mentioned in errors
  const sourceSnippets: string[] = [];
  for (const err of errors) {
    if (err.file) {
      const fullPath = path.isAbsolute(err.file) ? err.file : path.join(projectPath, err.file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const start = Math.max(0, (err.line || 1) - 5);
        const end = Math.min(lines.length, (err.line || 1) + 5);
        sourceSnippets.push(
          `--- ${err.file} (lines ${start + 1}-${end}) ---\n` +
          lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n')
        );
      }
    }
  }

  const errorSummary = errors
    .map(e => {
      let entry = `- [${e.type}] ${e.file ? e.file + ':' + (e.line || '?') + ' ' : ''}${e.message}`;
      if (e.stack) {
        entry += '\n  Stack trace:\n' + e.stack.split('\n').map(l => '    ' + l.trimStart()).join('\n');
      }
      return entry;
    })
    .join('\n');

  return `Fix the following errors in this Phaser 3 game project.

## Errors
${errorSummary}

## Relevant Source Code
${sourceSnippets.join('\n\n') || '(no source files identified)'}

## Game Design Document
Read the full GDD at: ${gddPath}

## Rules
1. ONLY modify files under src/scenes/, src/entities/, src/config/
2. Fix the specific errors listed above
3. Do NOT add new features — only fix the bugs
4. Keep changes minimal and targeted`;
}

/**
 * Self-healing loop: attempt to auto-fix errors by sending them to the coder agent.
 * Retries up to MAX_RETRIES times.
 *
 * **Project-scoped**: this loop is always bound to an explicit `projectPath`;
 * every `preview:status` event and every Coder-related `agent:stream` event
 * emitted by this function is scoped to that project via CoderSessionManager,
 * so background-project self-heal never bleeds into the foreground
 * LiveView/ChatPanel.
 *
 * Returns true if the build eventually succeeds.
 */
export async function selfHeal(options: {
  errors: ParsedError[];
  projectPath?: string;
  win?: BrowserWindow;
}): Promise<{
  success: boolean;
  attempts: number;
  finalErrors?: ParsedError[];
}> {
  const projectDir = options.projectPath || getActiveProject();
  if (!projectDir) {
    return { success: false, attempts: 0, finalErrors: options.errors };
  }

  const win = options.win || BrowserWindow.getAllWindows()[0];
  let currentErrors = options.errors;

  const sendPreviewStatus = (payload: Record<string, unknown>) => {
    win?.webContents.send('preview:status', { ...payload, projectPath: projectDir });
  };

  // Track the previous attempt's coder-failure fingerprint so we can detect
  // "stuck in a loop" situations (same error twice in a row) and abort early.
  let previousCoderErrorFingerprint = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log('[SelfHeal] Attempt %d/%d — errors: %s', attempt, MAX_RETRIES, currentErrors.map(e => e.message.slice(0, 80)).join('; '));

    // Unique batch id scoped to this project (safe across parallel projects).
    const selfHealId = coderSessionManager.startBatch(projectDir);

    const emit = (
      type: 'tool-call' | 'tool-result' | 'status' | 'output' | 'agent-message',
      payload: Record<string, unknown>,
    ) => {
      coderSessionManager.emitEvent(projectDir, {
        batchId: selfHealId,
        type,
        payload,
      });
    };

    // Notify preview status (foreground-only UI affordance; LiveView filters
    // by projectPath anyway). Kept OUTSIDE onDequeue: this is a `preview:status`
    // event (not `agent:stream`), is independent of batchId, and UX-wise the
    // user expects to see "self-healing" immediately, not only once the
    // coder queue dequeues this attempt.
    sendPreviewStatus({
      status: 'self-healing',
      attempt,
      maxAttempts: MAX_RETRIES,
    });

    // Build the fix prompt up-front so the coder-runner can be invoked
    // without side effects; all user-visible event emission is deferred to
    // `onDequeue` (fires the instant the SerialQueue hands control to us).
    const fixPrompt = buildFixPrompt(currentErrors, projectDir);

    // Ask coder agent to fix — stream status and output to renderer
    const coderResult = await runCoderAgent({
      projectPath: projectDir,
      summary: fixPrompt,
      onStatus: (status) => {
        const label = status === 'agent:planning' ? `fixing (attempt ${attempt}/${MAX_RETRIES}) — planning`
          : status === 'agent:coding' ? `fixing (attempt ${attempt}/${MAX_RETRIES}) — coding`
          : `fixing (attempt ${attempt}/${MAX_RETRIES})`;
        emit('status', { text: label });
      },
      onOutput: (line) => {
        emit('output', { text: line });
      },
      onDequeue: () => {
        // Register this attempt's batchId so cancel can mark it `__cancelled`.
        // This path previously had NO `setCurrentBatchId` call, so
        // `coder:cancel` during self-heal would silently miss the bubble.
        //
        // Closure safety: onDequeue runs synchronously inside the enqueue
        // task, i.e. before `await runCoderAgent(...)` resolves. The `for`
        // loop cannot advance past `attempt` until that Promise settles, so
        // `currentErrors`, `attempt`, and `selfHealId` are stable here.
        coderSessionManager.setCurrentBatchId(projectDir, selfHealId);

        // Start a new Code Agent bubble for this attempt
        emit('tool-call', {
          toolCallId: selfHealId,
          toolName: 'send_to_coder',
        });

        // Show captured errors as initial coder output
        emit('status', { text: `fixing (attempt ${attempt}/${MAX_RETRIES})` });
        emit('output', { text: `🔍 Captured ${currentErrors.length} error(s):` });
        for (const err of currentErrors) {
          const loc = err.file ? `${err.file}:${err.line || '?'}` : '';
          emit('output', { text: `  ❌ ${loc} ${err.message}` });
          if (err.stack) {
            // Show stack trace lines indented
            for (const stackLine of err.stack.split('\n').slice(0, 8)) {
              emit('output', { text: `     ${stackLine.trimStart()}` });
            }
          }
        }
        emit('output', { text: '' });
        emit('output', { text: `🔧 Sending to Code Agent for auto-fix...` });
      },
    });

    if (!coderResult.success) {
      const errMsg = coderResult.error || 'unknown error';
      const fingerprint = errorFingerprint(errMsg);
      const unrecoverable = isUnrecoverable(errMsg);
      const repeated =
        !!previousCoderErrorFingerprint &&
        fingerprint === previousCoderErrorFingerprint;

      // Decide whether to bail out of the whole self-heal session instead of
      // burning the remaining retry budget on a failure mode that cannot
      // improve between attempts.
      const shouldAbort = unrecoverable || repeated;

      const reasonLabel = unrecoverable
        ? 'unrecoverable error'
        : repeated
          ? 'same error as previous attempt'
          : 'agent error';

      emit('status', {
        text: shouldAbort
          ? `aborted — ${reasonLabel}`
          : `attempt ${attempt} failed — ${reasonLabel}`,
      });
      emit('output', { text: `❌ Code Agent failed: ${errMsg}` });

      if (shouldAbort) {
        const abortNote = unrecoverable
          ? '⛔ Error appears unrecoverable (missing binary / auth / quota). Aborting self-heal and surfacing to user.'
          : '⛔ Same error as previous attempt — not making progress. Aborting self-heal to avoid wasting retries.';
        emit('output', { text: abortNote });
      }

      emit('tool-result', { toolCallId: selfHealId, __terminal: true });
      emit('status', { text: 'done', __terminal: true });

      console.log(
        '[SelfHeal] Coder agent failed on attempt %d (unrecoverable=%s, repeated=%s)',
        attempt,
        unrecoverable,
        repeated,
      );

      if (shouldAbort) {
        sendPreviewStatus({
          status: 'self-heal-failed',
          errors: currentErrors,
          reason: reasonLabel,
        });
        return {
          success: false,
          attempts: attempt,
          finalErrors: currentErrors,
        };
      }

      previousCoderErrorFingerprint = fingerprint;
      continue;
    }

    // Clear the fingerprint on successful coder run — next failure (if any)
    // should be compared only against this new run's error, not older ones.
    previousCoderErrorFingerprint = '';

    // Try rebuilding
    emit('output', { text: '' });
    emit('output', { text: '🏗️ Rebuilding preview...' });
    emit('status', { text: `attempt ${attempt} — rebuilding` });

    const buildResult = await runH5Build(projectDir);

    if (buildResult.success) {
      emit('status', { text: 'done' });
      emit('output', { text: `✅ Build succeeded! Preview refreshing...` });
      emit('tool-result', { toolCallId: selfHealId, __terminal: true });

      // Restart preview server ONLY if this project is foreground.
      // Background self-heal leaves dist-h5 fresh; serve will be started on
      // project:resume-preview when the user switches back.
      if (projectDir === getActiveProject()) {
        try {
          const url = await startVitePreview(projectDir);
          sendPreviewStatus({ status: 'ready', url });
          win?.webContents.send('preview:refresh', { url, projectPath: projectDir });
        } catch { /* ignore */ }
      } else {
        sendPreviewStatus({ status: 'built-idle' });
      }

      console.log('[SelfHeal] Fixed on attempt %d', attempt);
      return { success: true, attempts: attempt };
    }

    // Build failed — show new errors and continue
    currentErrors = parseBuildError(buildResult.error || buildResult.output);
    emit('output', { text: `❌ Build still failing — ${currentErrors.length} error(s) remaining` });
    emit('status', { text: `attempt ${attempt} — build failed` });
    emit('tool-result', { toolCallId: selfHealId, __terminal: true });
  }

  // All retries exhausted
  console.log('[SelfHeal] All %d attempts exhausted', MAX_RETRIES);
  sendPreviewStatus({
    status: 'self-heal-failed',
    errors: currentErrors,
  });

  return {
    success: false,
    attempts: MAX_RETRIES,
    finalErrors: currentErrors,
  };
}
