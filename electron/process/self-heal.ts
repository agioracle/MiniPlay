import { BrowserWindow } from 'electron';
import { runCoderAgent } from '../coder/coder-runner';
import { runH5Build } from './build-manager';
import { startVitePreview } from './vite-manager';
import { getActiveProject } from '../project/state';
import { parseBuildError, type ParsedError } from './error-parser';
import * as fs from 'fs';
import * as path from 'path';

const MAX_RETRIES = 3;

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
 * Self-healing loop: attempt to auto-fix errors by sending them to opencode.
 * Retries up to MAX_RETRIES times.
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

  const send = (data: Record<string, unknown>) => {
    win?.webContents.send('agent:stream', data);
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log('[SelfHeal] Attempt %d/%d — errors: %s', attempt, MAX_RETRIES, currentErrors.map(e => e.message.slice(0, 80)).join('; '));

    const selfHealId = `selfheal_${attempt}_${Date.now()}`;

    const sendBatch = (data: Record<string, unknown>) => {
      send({ ...data, batchId: selfHealId });
    };

    // Close previous attempt's bubble (if any)
    if (attempt > 1) {
      // Previous batch already got done via its own batchId
    }

    // Notify preview status
    win?.webContents.send('preview:status', {
      status: 'self-healing',
      attempt,
      maxAttempts: MAX_RETRIES,
    });

    // Start a new Code Agent bubble for this attempt
    sendBatch({
      type: 'tool-call',
      toolCallId: selfHealId,
      toolName: 'send_to_coder',
    });

    // Show captured errors as initial coder output
    sendBatch({
      type: 'coder-status',
      text: `fixing (attempt ${attempt}/${MAX_RETRIES})`,
    });
    sendBatch({
      type: 'coder-output',
      text: `🔍 Captured ${currentErrors.length} error(s):`,
    });
    for (const err of currentErrors) {
      const loc = err.file ? `${err.file}:${err.line || '?'}` : '';
      sendBatch({ type: 'coder-output', text: `  ❌ ${loc} ${err.message}` });
      if (err.stack) {
        // Show stack trace lines indented
        for (const stackLine of err.stack.split('\n').slice(0, 8)) {
          sendBatch({ type: 'coder-output', text: `     ${stackLine.trimStart()}` });
        }
      }
    }
    sendBatch({ type: 'coder-output', text: '' });
    sendBatch({ type: 'coder-output', text: `🔧 Sending to Code Agent for auto-fix...` });

    // Ask coder agent to fix — stream status and output to renderer
    const fixPrompt = buildFixPrompt(currentErrors, projectDir);
    const coderResult = await runCoderAgent({
      projectPath: projectDir,
      summary: fixPrompt,
      onStatus: (status) => {
        const label = status === 'agent:planning' ? `fixing (attempt ${attempt}/${MAX_RETRIES}) — planning`
          : status === 'agent:coding' ? `fixing (attempt ${attempt}/${MAX_RETRIES}) — coding`
          : `fixing (attempt ${attempt}/${MAX_RETRIES})`;
        sendBatch({ type: 'coder-status', text: label });
      },
      onOutput: (line) => {
        sendBatch({ type: 'coder-output', text: line });
      },
    });

    if (!coderResult.success) {
      sendBatch({ type: 'coder-status', text: `attempt ${attempt} failed — agent error` });
      sendBatch({ type: 'coder-output', text: `❌ Code Agent failed: ${coderResult.error || 'unknown error'}` });
      sendBatch({ type: 'tool-result', toolCallId: selfHealId });
      sendBatch({ type: 'done' });
      console.log('[SelfHeal] Coder agent failed on attempt %d', attempt);
      continue;
    }

    // Try rebuilding
    sendBatch({ type: 'coder-output', text: '' });
    sendBatch({ type: 'coder-output', text: '🏗️ Rebuilding preview...' });
    sendBatch({ type: 'coder-status', text: `attempt ${attempt} — rebuilding` });

    const buildResult = await runH5Build(projectDir);

    if (buildResult.success) {
      sendBatch({ type: 'coder-status', text: 'done' });
      sendBatch({ type: 'coder-output', text: `✅ Build succeeded! Preview refreshing...` });
      sendBatch({ type: 'tool-result', toolCallId: selfHealId });
      sendBatch({ type: 'done' });

      // Restart preview server
      try {
        const url = await startVitePreview(projectDir);
        win?.webContents.send('preview:status', { status: 'ready', url });
        win?.webContents.send('preview:refresh', { url });
      } catch {}

      console.log('[SelfHeal] Fixed on attempt %d', attempt);
      return { success: true, attempts: attempt };
    }

    // Build failed — show new errors and continue
    currentErrors = parseBuildError(buildResult.error || buildResult.output);
    sendBatch({ type: 'coder-output', text: `❌ Build still failing — ${currentErrors.length} error(s) remaining` });
    sendBatch({ type: 'coder-status', text: `attempt ${attempt} — build failed` });
    sendBatch({ type: 'tool-result', toolCallId: selfHealId });
    sendBatch({ type: 'done' });
  }

  // All retries exhausted
  console.log('[SelfHeal] All %d attempts exhausted', MAX_RETRIES);
  win?.webContents.send('preview:status', {
    status: 'self-heal-failed',
    errors: currentErrors,
  });

  return {
    success: false,
    attempts: MAX_RETRIES,
    finalErrors: currentErrors,
  };
}
