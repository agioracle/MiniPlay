import { ipcMain, BrowserWindow } from 'electron';
import { runGdAgentTurn } from '../agent/gd-agent';
import { appendMessage, readMessages, type StoredMessage } from '../agent/message-store';
import { getActiveProject } from '../project/state';
import type { ModelMessage } from 'ai';

/**
 * In-memory buffer for messages sent before a project exists.
 * Flushed to project's conversations.jsonl once create_project sets activeProject.
 */
let pendingMessages: StoredMessage[] = [];

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
 * Called when a project becomes active mid-turn.
 */
function flushPendingMessages(projectPath: string): void {
  for (const msg of pendingMessages) {
    appendMessage(projectPath, msg);
  }
  pendingMessages = [];
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

      // Load history (persisted + any in-memory pending messages)
      const persisted = projectPath ? readMessages(projectPath) : [];
      const history = [...persisted, ...pendingMessages];

      console.log('[GD Agent] History: %d persisted + %d pending messages', persisted.length, pendingMessages.length);

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
        // No project yet — buffer in memory
        pendingMessages.push(userMsg);
      }

      // Build message array for the LLM
      const modelMessages = toModelMsgs([...history, userMsg]);

      try {
        console.log('[GD Agent] Running PM agent turn with %d messages...', modelMessages.length);
        const result = await runGdAgentTurn(modelMessages, win);

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
          // Still no project — keep buffering
          pendingMessages.push(assistantMsg);
        }

        return { text: result.text, toolCalls: result.toolCalls, projectCreated };
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        console.error('[GD Agent] Error:', errorMsg);
        win.webContents.send('agent:stream', { type: 'error', error: errorMsg });
        return { error: errorMsg };
      }
    },
  );

  ipcMain.handle('agent:history', async (_event, projectPath: string) => {
    return readMessages(projectPath);
  });

  /** Clear pending buffer (e.g. when user navigates back to home) */
  ipcMain.handle('agent:clear-pending', async () => {
    pendingMessages = [];
    return { success: true };
  });
}
