import { spawn, execSync } from 'child_process';
import * as path from 'path';
import { SerialQueue } from './queue';
import { buildCoderPrompt } from './prompt-builder';
import { CODER_AGENTS, DEFAULT_CODER_AGENT, type CoderAgentId, type CoderAgentDef } from './agents';
import { readConfig } from '../storage/config';
import { getCoderBinaryPath } from '../hydration/env-cache';
import { readSession, writeSession, clearSession } from './session';

const queue = new SerialQueue();

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
 * Detect changed files by comparing git status before and after.
 */
function getChangedFiles(projectPath: string): string[] {
  try {
    const output = execSync('git diff --name-only HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'pipe',
    }).trim();
    if (!output) return [];
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
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
 * Extract the final result text from a stream-json result message.
 */
function tryExtractResultText(jsonLine: string): string | null {
  try {
    const parsed = JSON.parse(jsonLine);
    if (parsed.type === 'result' && parsed.result) {
      return typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result);
    }
  } catch {}
  return null;
}

/**
 * Run the configured coder agent to modify code based on the GDD patch.
 * Enqueued to ensure serial execution (one agent at a time per project).
 * Supports session persistence: resumes previous session for context continuity.
 */
export function runCoderAgent(options: {
  projectPath: string;
  summary: string;
  onStatus?: (status: string) => void;
  onOutput?: (line: string) => void;
}): Promise<CoderResult> {
  return queue.enqueue(async () => {
    const { projectPath, summary, onStatus, onOutput } = options;
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

      // Immediately close stdin to avoid "no stdin data received" warning
      child.stdin.end();

      let stdout = '';
      let stderr = '';
      let settled = false;
      let capturedSessionId: string | null = null;
      let capturedResultText: string | null = null;

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
            // Try to capture result text
            const rt = tryExtractResultText(trimmed);
            if (rt) capturedResultText = rt;

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
          resolve({
            success: false,
            status: 'failed',
            changedFiles: [],
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

        const changedFiles = getChangedFiles(projectPath);
        console.log('[Coder] Process exited with code %d, changed files: %s', code, changedFiles.join(', ') || '(none)');

        // If session resume failed, clear the session so next call starts fresh
        if (code !== 0 && sessionId && stderr.includes('session')) {
          console.log('[Coder] Session resume may have failed, clearing session');
          clearSession(projectPath);
        }

        if (code !== 0) {
          if (changedFiles.length > 0) {
            resolve({
              success: true,
              status: 'completed',
              changedFiles,
              output: stdout,
              resultText: capturedResultText || undefined,
              error: stderr || undefined,
              agentUsed: agent.name,
            });
          } else {
            resolve({
              success: false,
              status: 'failed',
              changedFiles: [],
              output: stdout,
              resultText: capturedResultText || undefined,
              error: stderr || `${agent.name} exited with code ${code}`,
              agentUsed: agent.name,
            });
          }
          return;
        }

        resolve({
          success: true,
          status: 'completed',
          changedFiles,
          output: stdout,
          resultText: capturedResultText || undefined,
          agentUsed: agent.name,
        });
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
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

      // Kill on app exit
      process.on('exit', () => {
        try { child.kill(); } catch {}
      });
    });
  });
}
