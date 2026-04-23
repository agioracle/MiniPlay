import { ipcMain, BrowserWindow } from 'electron';
import { runGdAgentTurn } from '../agent/gd-agent';
import { appendMessage, readMessages, type StoredMessage } from '../agent/message-store';
import { getActiveProject } from '../project/state';
import type { ModelMessage } from 'ai';

/**
 * In-memory buffers for messages sent before (or outside of) a project
 * context. Keyed by projectPath so parallel GD threads targeting different
 * (already-created) projects do not bleed into each other. The special
 * `__none__` bucket collects messages authored before any project exists
 * (pre-create-project turns).
 *
 * YAGNI: multiple concurrent pre-project threads still collapse into the
 * `__none__` bucket. In practice the user only has one "new project"
 * conversation at a time, so differentiating them further is not worth
 * the complexity.
 */
const NONE_BUCKET = '__none__' as const;
const pendingMessages = new Map<string | typeof NONE_BUCKET, StoredMessage[]>();

function getPendingBucket(key: string | typeof NONE_BUCKET): StoredMessage[] {
  let bucket = pendingMessages.get(key);
  if (!bucket) {
    bucket = [];
    pendingMessages.set(key, bucket);
  }
  return bucket;
}

export interface ImageData {
  name: string;
  mimeType: string;
  base64: string;
}

/** Convert our stored messages into Vercel AI SDK ModelMessage format */
function toModelMsgs(stored: StoredMessage[]): ModelMessage[] {
  const msgs: ModelMessage[] = [];
  for (const m of stored) {
    if (m.role === 'user') {
      if (m.images && m.images.length > 0) {
        // Multimodal message: text + images
        const content: Array<{ type: string; text?: string; image?: string; mimeType?: string }> = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content });
        }
        for (const img of m.images) {
          content.push({
            type: 'image',
            image: img.base64,
            mimeType: img.mimeType,
          });
        }
        msgs.push({ role: 'user', content: content as any });
      } else {
        msgs.push({ role: 'user', content: m.content });
      }
    } else if (m.role === 'assistant') {
      msgs.push({ role: 'assistant', content: m.content });
    }
  }
  return msgs;
}

/**
 * Flush pending messages to a project's conversations.jsonl.
 * Called when a project becomes active mid-turn. Drains both the
 * project-specific bucket (if any) and the pre-project `__none__` bucket.
 */
function flushPendingMessages(projectPath: string): void {
  for (const bucketKey of [NONE_BUCKET, projectPath]) {
    const bucket = pendingMessages.get(bucketKey);
    if (!bucket) continue;
    for (const msg of bucket) {
      appendMessage(projectPath, msg);
    }
    pendingMessages.delete(bucketKey);
  }
}

export function registerAgentHandlers() {
  ipcMain.handle(
    'agent:send',
    async (event, payload: { message: string; projectPath?: string; images?: ImageData[] }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { error: 'No window' };

      const { message } = payload;
      // Use provided projectPath or fall back to active project
      let projectPath = payload.projectPath || getActiveProject();

      console.log('[GD Agent] Received message:', message.slice(0, 80));
      console.log('[GD Agent] Active project:', projectPath || '(none)');

      // Bucket key for the pending buffer — per-project if available,
      // otherwise the shared `__none__` bucket.
      const bucketKey: string | typeof NONE_BUCKET = projectPath ?? NONE_BUCKET;
      const pendingForThisThread = getPendingBucket(bucketKey);

      // Load history (persisted + any in-memory pending messages from this bucket)
      const persisted = projectPath ? readMessages(projectPath) : [];
      const history = [...persisted, ...pendingForThisThread];

      console.log(
        '[GD Agent] History: %d persisted + %d pending (bucket=%s)',
        persisted.length,
        pendingForThisThread.length,
        bucketKey,
      );

      // Create user message
      const userMsg: StoredMessage = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
        images: payload.images,
      };

      if (projectPath) {
        appendMessage(projectPath, userMsg);
      } else {
        // No project yet — buffer in the `__none__` bucket
        pendingForThisThread.push(userMsg);
      }

      // Build message array for the LLM
      const modelMessages = toModelMsgs([...history, userMsg]);

      try {
        console.log('[GD Agent] Running PM agent turn with %d messages...', modelMessages.length);
        const result = await runGdAgentTurn(modelMessages, win, projectPath);

        console.log('[GD Agent] Turn complete. Text length: %d, Tool calls: %d', result.text.length, result.toolCalls.length);

        // Re-check: a project may have been created during this turn
        // (create_project tool calls setActiveProject)
        let projectCreated = false;
        if (!projectPath) {
          projectPath = getActiveProject();
          if (projectPath) {
            projectCreated = true;
            // Flush all buffered messages (including the userMsg we just added)
            flushPendingMessages(projectPath);
          }
        }

        // Persist assistant response
        const assistantMsg: StoredMessage = {
          id: `msg_${Date.now()}_assistant`,
          role: 'assistant',
          content: result.text,
          timestamp: new Date().toISOString(),
          toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
          toolResults: result.toolResults.length > 0 ? result.toolResults : undefined,
        };

        if (projectPath) {
          appendMessage(projectPath, assistantMsg);
        } else {
          // Still no project — keep buffering in the pre-project bucket.
          getPendingBucket(NONE_BUCKET).push(assistantMsg);
        }

        // Check if update_gdd was called during this turn
        const gddUpdated = result.toolCalls.some(tc => tc.name === 'update_gdd');

        return { text: result.text, toolCalls: result.toolCalls, projectCreated, gddUpdated };
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        console.error('[GD Agent] Error:', errorMsg);
        // Annotate with projectPath (possibly null) so the renderer can decide
        // whether the error belongs to the current view.
        win.webContents.send('agent:stream', {
          type: 'error',
          error: errorMsg,
          projectPath: projectPath ?? null,
        });
        return { error: errorMsg };
      }
    },
  );

  ipcMain.handle('agent:history', async (_event, projectPath: string) => {
    return readMessages(projectPath);
  });

  /**
   * Clear pending buffers. By default drains only the pre-project
   * `__none__` bucket (back-compat with the legacy "navigate home" flow).
   * Pass `projectPath` to drain a specific project's bucket instead.
   */
  ipcMain.handle(
    'agent:clear-pending',
    async (_event, payload: { projectPath?: string } | undefined) => {
      if (payload?.projectPath) {
        pendingMessages.delete(payload.projectPath);
      } else {
        pendingMessages.delete(NONE_BUCKET);
      }
      return { success: true };
    },
  );
}
