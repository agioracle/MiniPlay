import { spawn, execSync } from 'child_process';
import * as path from 'path';
import { buildCoderPrompt } from './prompt-builder';
import { CODER_AGENTS, DEFAULT_CODER_AGENT, type CoderAgentId, type CoderAgentDef } from './agents';
import { readConfig } from '../storage/config';
import { getCoderBinaryPath } from '../hydration/env-cache';
import { readSession, writeSession, clearSession } from './session';
import { coderSessionManager } from './session-manager';

export interface CoderResult {
  success: boolean;
  status: 'completed' | 'failed';
  changedFiles: string[];
  output: string;
  /** Clean final summary text from the coder agent (extracted from result message) */
  resultText?: string;
  error?: string;
  agentUsed: string;
}

/**
 * Snapshot the current dirty file set (tracked modifications + untracked) so we
 * can later diff against it to isolate files changed by THIS coder invocation.
 * Using only `git diff --name-only HEAD` would also count pre-existing dirty
 * files from earlier iterations, leading to false-positive success detection.
 */
function snapshotDirtyFiles(projectPath: string): Set<string> {
  try {
    // `git status --porcelain` covers both tracked changes AND untracked files.
    const output = execSync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'pipe',
    }).trim();
    if (!output) return new Set();
    const files = output
      .split('\n')
      .map((line) => line.slice(3).trim()) // strip 2-char status + space
      .filter(Boolean);
    return new Set(files);
  } catch {
    return new Set();
  }
}

/**
 * Detect files changed by the current coder invocation, excluding pre-existing
 * dirty files captured in the baseline.
 */
function getNewlyChangedFiles(projectPath: string, baseline: Set<string>): string[] {
  const current = snapshotDirtyFiles(projectPath);
  const diff: string[] = [];
  for (const f of current) {
    if (!baseline.has(f)) diff.push(f);
  }
  return diff;
}

/**
 * Get the currently configured coder agent definition.
 */
function getActiveAgent(): CoderAgentDef {
  const config = readConfig();
  const agentId = (config.coderAgent || DEFAULT_CODER_AGENT) as CoderAgentId;
  return CODER_AGENTS[agentId] || CODER_AGENTS[DEFAULT_CODER_AGENT];
}

/**
 * Try to extract a session ID from a stream-json line.
 * Each line is a single JSON object: {type: "system", subtype: "init", session_id: "..."}
 */
function tryExtractSessionId(jsonLine: string): string | null {
  try {
    const parsed = JSON.parse(jsonLine);
    if (parsed.type === 'system' && parsed.subtype === 'init' && parsed.session_id) {
      return parsed.session_id;
    }
    if (parsed.type === 'result' && parsed.session_id) {
      return parsed.session_id;
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

/**
 * Extract human-readable text from a stream-json line for UI display.
 */
function extractDisplayText(jsonLine: string): string | null {
  try {
    const parsed = JSON.parse(jsonLine);
    if (parsed.type === 'assistant' && parsed.message?.content) {
      const texts = parsed.message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);
      if (texts.length > 0) return texts.join('\n');
    }
    if (parsed.type === 'result' && parsed.result) {
      return `[Result] ${typeof parsed.result === 'string' ? parsed.result.slice(0, 200) : JSON.stringify(parsed.result).slice(0, 200)}`;
    }
  } catch {
    // Not JSON — return raw line
    return jsonLine;
  }
  return null;
}

/**
 * Parsed metadata from a stream-json `result` message. CLIs like claude-code
 * emit one such message at the very end carrying authoritative success info:
 *   { type: "result", subtype: "success" | "error_max_turns" | "error_during_execution" | ...,
 *     is_error: boolean, result: string, num_turns, total_cost_usd, ... }
 */
interface CoderResultMeta {
  text: string | null;
  subtype: string | null;
  isError: boolean | null;
}

/**
 * Extract the final result text + error metadata from a stream-json result line.
 */
function tryExtractResultMeta(jsonLine: string): CoderResultMeta | null {
  try {
    const parsed = JSON.parse(jsonLine);
    if (parsed.type !== 'result') return null;
    const text =
      parsed.result == null
        ? null
        : typeof parsed.result === 'string'
          ? parsed.result
          : JSON.stringify(parsed.result);
    return {
      text,
      subtype: typeof parsed.subtype === 'string' ? parsed.subtype : null,
      isError: typeof parsed.is_error === 'boolean' ? parsed.is_error : null,
    };
  } catch {}
  return null;
}

/**
 * Run the configured coder agent to modify code based on the GDD patch.
 * Tasks for the same project are serialized via CoderSessionManager's
 * per-project queue; different projects run in parallel.
 * Supports session persistence: resumes previous session for context continuity.
 */
export function runCoderAgent(options: {
  projectPath: string;
  summary: string;
  onStatus?: (status: string) => void;
  onOutput?: (line: string) => void;
  /**
   * Invoked synchronously at the instant the SerialQueue dequeues this task,
   * immediately before the coder child process is spawned. Use this to
   * register the in-flight batchId and emit the first user-visible events
   * (e.g. `tool-call`, `launching` status). Runs inside the queue's critical
   * section, so it is guaranteed to be serialized against prior same-project
   * tasks' `finally` cleanup. Must be synchronous; errors are swallowed with
   * a console.warn to avoid corrupting queue state.
   */
  onDequeue?: () => void;
}): Promise<CoderResult> {
  const { projectPath } = options;
  return coderSessionManager.enqueue(projectPath, async (session) => {
    // Fire once, synchronously, at the instant the queue hands control to us.
    // This is the ONLY moment at which it is safe to register `currentBatchId`
    // for this task: the previous same-project task's finally block has
    // already cleared the slot. Errors are swallowed — a throwing callback
    // only degrades cancel-attribution for this one run and must not corrupt
    // the queue's running/pending bookkeeping.
    try {
      options.onDequeue?.();
    } catch (err) {
      console.warn('[Coder] onDequeue callback threw:', err);
    }
    const { summary, onStatus, onOutput } = options;
    const agent = getActiveAgent();

    console.log('[Coder] Using agent: %s (%s)', agent.name, agent.id);

    // Look up the binary path from startup detection cache
    const cachedPath = getCoderBinaryPath(agent.id);
    if (!cachedPath) {
      console.error('[Coder] Binary not found in env-cache for agent: %s', agent.id);
      return {
        success: false,
        status: 'failed' as const,
        changedFiles: [],
        output: '',
        error: `${agent.name} is not installed or not detected. Please check Settings and ensure it is installed. (Detected path: none)`,
        agentUsed: agent.name,
      };
    }

    const prompt = buildCoderPrompt({ projectPath, summary });
    console.log('[Coder] Prompt length: %d chars', prompt.length);

    // Read existing session for this project
    const existingSession = readSession(projectPath, agent.id);
    const sessionId = existingSession?.sessionId || undefined;

    if (sessionId) {
      console.log('[Coder] Resuming session: %s', sessionId);
    } else {
      console.log('[Coder] Starting new session');
    }

    onStatus?.('agent:planning');

    // Snapshot pre-existing dirty files BEFORE launching the CLI so we can
    // isolate files changed by this run from older uncommitted changes.
    const dirtyBaseline = snapshotDirtyFiles(projectPath);
    console.log('[Coder] Dirty baseline: %d pre-existing files', dirtyBaseline.size);

    return new Promise<CoderResult>((resolve) => {
      const timeoutMs = 3600000; // 60 minutes

      onStatus?.('agent:coding');

      const [bin, ...args] = agent.buildCommand(prompt, cachedPath, sessionId);
      console.log('[Coder] Spawning: %s %s', bin, args.map(a => a.length > 50 ? a.slice(0, 50) + '...' : a).join(' '));

      const child = spawn(bin, args, {
        cwd: projectPath,
        env: {
          ...process.env,
          ...(agent.env || {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Register the spawned child on the per-project session so
      // `coder:cancel` can SIGTERM/SIGKILL it. We don't know the batchId at
      // this layer (it's owned by the IPC caller), so pass null to keep
      // whatever the caller already set.
      coderSessionManager.setCurrentChild(projectPath, child, null);

      // Immediately close stdin to avoid "no stdin data received" warning
      child.stdin.end();

      let stdout = '';
      let stderr = '';
      let settled = false;
      let capturedSessionId: string | null = null;
      let capturedResultMeta: CoderResultMeta | null = null;

      // Stream stdout — parse JSON for structured agents, raw lines otherwise
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;

        const lines = text.split('\n');
        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (!trimmed) continue;

          // Try to capture session ID from JSON output
          if (!capturedSessionId) {
            const sid = tryExtractSessionId(trimmed);
            if (sid) {
              capturedSessionId = sid;
              console.log('[Coder] Captured session ID: %s', sid);
              writeSession(projectPath, sid, agent.id);
            }
          }

          // Extract display text for UI
          if (agent.jsonOutput) {
            // Capture authoritative result metadata (subtype, is_error) — used
            // below to decide success, not just for UI display.
            const meta = tryExtractResultMeta(trimmed);
            if (meta) capturedResultMeta = meta;

            const displayText = extractDisplayText(trimmed);
            if (displayText) {
              onOutput?.(displayText);
            }
          } else {
            onOutput?.(trimmed);
          }
        }
      });

      // Stream stderr line by line
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        const lines = text.split('\n');
        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (trimmed) {
            onOutput?.(trimmed);
          }
        }
      });

      // Timeout
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          console.error('[Coder] Process timed out after 60 minutes');
          try { child.kill('SIGKILL'); } catch {}
          coderSessionManager.setCurrentChild(projectPath, null, null);
          resolve({
            success: false,
            status: 'failed',
            changedFiles: getNewlyChangedFiles(projectPath, dirtyBaseline),
            output: stdout,
            error: `${agent.name} timed out after 60 minutes`,
            agentUsed: agent.name,
          });
        }
      }, timeoutMs);

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        coderSessionManager.setCurrentChild(projectPath, null, null);

        // Files changed by THIS invocation only (excludes pre-existing dirty).
        const changedFiles = getNewlyChangedFiles(projectPath, dirtyBaseline);
        const resultText = capturedResultMeta?.text ?? null;
        const resultSubtype = capturedResultMeta?.subtype ?? null;
        const resultIsError = capturedResultMeta?.isError ?? null;

        console.log(
          '[Coder] Process exited: code=%d, newly-changed=%d, result.subtype=%s, result.is_error=%s',
          code,
          changedFiles.length,
          resultSubtype ?? '(none)',
          resultIsError === null ? '(none)' : String(resultIsError),
        );

        // If session resume failed, clear the session so next call starts fresh
        if (code !== 0 && sessionId && stderr.includes('session')) {
          console.log('[Coder] Session resume may have failed, clearing session');
          clearSession(projectPath);
        }

        // ---------------------------------------------------------------
        // Strict success determination (no "changedFiles > 0" fallback).
        //
        // A run is ONLY considered successful when BOTH:
        //   1. Process exited with code 0, AND
        //   2. Either the CLI emitted a structured result with subtype="success"
        //      and is_error !== true, OR the CLI did not emit any structured
        //      result at all (non-JSON agents like raw shell cases).
        //
        // Any deviation (non-zero exit, is_error=true, error_* subtype such as
        // error_max_turns / error_during_execution) is treated as failure,
        // regardless of how many files were written. This prevents the prior
        // false-positive where a mid-run crash left partial edits on disk and
        // the runner wrongly reported success.
        // ---------------------------------------------------------------
        let success = code === 0;
        let failureReason: string | null = null;

        if (resultIsError === true) {
          success = false;
          failureReason = `Coder reported is_error=true${resultSubtype ? ` (subtype=${resultSubtype})` : ''}`;
        } else if (resultSubtype && resultSubtype !== 'success') {
          success = false;
          failureReason = `Coder result subtype=${resultSubtype}`;
        } else if (code !== 0) {
          failureReason = `${agent.name} exited with code ${code}`;
        }

        if (!success) {
          resolve({
            success: false,
            status: 'failed',
            changedFiles,
            output: stdout,
            resultText: resultText || undefined,
            error: stderr?.trim() || failureReason || `${agent.name} exited with code ${code}`,
            agentUsed: agent.name,
          });
          return;
        }

        resolve({
          success: true,
          status: 'completed',
          changedFiles,
          output: stdout,
          resultText: resultText || undefined,
          agentUsed: agent.name,
        });
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        coderSessionManager.setCurrentChild(projectPath, null, null);
        console.error('[Coder] Spawn error:', err.message);
        resolve({
          success: false,
          status: 'failed',
          changedFiles: [],
          output: stdout,
          error: err.message,
          agentUsed: agent.name,
        });
      });

      // App-exit cleanup handled centrally by CoderSessionManager.killAll()
      // in electron/main.ts. No per-spawn `process.on('exit')` needed here
      // (would leak listeners on long-running sessions).
    });
  });
}
