import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { runCoderAgent } from '../coder/coder-runner';
import { getActiveProject } from '../project/state';
import { getEnvStatus } from '../hydration/env-cache';
import { readConfig } from '../storage/config';
import { refreshPreview } from '../process/preview-bridge';
import { appendMessage, type StoredMessage } from '../agent/message-store';

interface ImageData {
  name: string;
  mimeType: string;
  base64: string;
}

/**
 * Save images to the project's .miniplay/attachments/ directory.
 * Returns absolute file paths.
 */
function saveImagesToProject(projectPath: string, images: ImageData[]): string[] {
  const attachmentsDir = path.join(projectPath, '.miniplay', 'attachments');
  fs.mkdirSync(attachmentsDir, { recursive: true });

  const savedPaths: string[] = [];
  for (const img of images) {
    const ext = img.mimeType.split('/')[1] || 'png';
    const filename = `${Date.now()}_${img.name.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`;
    const filePath = path.join(attachmentsDir, filename);
    fs.writeFileSync(filePath, Buffer.from(img.base64, 'base64'));
    savedPaths.push(filePath);
  }
  return savedPaths;
}

export function registerCoderHandlers() {
  /** Direct coder invocation (legacy — used by send_to_coder tool) */
  ipcMain.handle(
    'coder:run',
    async (event, payload: { summary: string }) => {
      const projectPath = getActiveProject();
      if (!projectPath) return { error: 'No active project' };

      const win = BrowserWindow.fromWebContents(event.sender);

      const result = await runCoderAgent({
        projectPath,
        summary: payload.summary,
        onStatus: (status) => {
          if (win) {
            win.webContents.send('coder:status', { status });
          }
        },
      });

      return result;
    },
  );

  /**
   * Direct Code Agent messaging — user talks to Code Agent without GD Agent intermediary.
   * Used in the "code" phase after project + GDD are created.
   * Streams status/output events, auto-triggers build on success.
   * Persists both user message and Code Agent response to conversations.jsonl.
   */
  ipcMain.handle(
    'coder:send',
    async (event, payload: { message: string; images?: ImageData[] }) => {
      const projectPath = getActiveProject();
      if (!projectPath) {
        return { success: false, error: 'No active project. Create a project first.' };
      }

      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { success: false, error: 'No window' };

      console.log('[coder:send] Message: %s', payload.message.slice(0, 100));
      console.log('[coder:send] Active project: %s', projectPath);

      // Save images to project dir and build path references for prompt
      let imagePaths: string[] = [];
      if (payload.images && payload.images.length > 0) {
        imagePaths = saveImagesToProject(projectPath, payload.images);
        console.log('[coder:send] Saved %d images to project', imagePaths.length);
      }

      // Persist user message
      const userMsg: StoredMessage = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: payload.message,
        timestamp: new Date().toISOString(),
        images: payload.images,
      };
      appendMessage(projectPath, userMsg);

      // Build prompt with image paths if any
      let messageWithImages = payload.message;
      if (imagePaths.length > 0) {
        const pathList = imagePaths.map(p => `  - ${p}`).join('\n');
        messageWithImages += `\n\nAttached images (view these files for reference):\n${pathList}`;
      }

      const sendEvent = (data: Record<string, unknown>) => {
        win.webContents.send('agent:stream', data);
      };

      const onStatus = (status: string) => {
        sendEvent({ type: 'coder-status', text: status });
      };

      // Collect Code Agent's text output for summary
      const outputLines: string[] = [];
      const onOutput = (line: string) => {
        sendEvent({ type: 'coder-output', text: line });
        outputLines.push(line);
      };

      try {
        // Signal start
        sendEvent({ type: 'tool-call', toolCallId: 'coder_direct', toolName: 'send_to_coder' });
        onStatus('launching');

        const result = await runCoderAgent({
          projectPath,
          summary: messageWithImages,
          onStatus,
          onOutput,
        });

        onStatus(result.success ? 'done' : 'failed');
        sendEvent({ type: 'tool-result', toolCallId: 'coder_direct' });

        console.log('[coder:send] Result: %s, changed: %s', result.status, result.changedFiles.join(', ') || '(none)');

        // Build summary text for Code Agent's response message
        let summaryText: string;
        if (result.success) {
          const filesStr = result.changedFiles.length > 0
            ? `Modified files: ${result.changedFiles.join(', ')}`
            : 'No files changed';
          // Prefer the clean result text from the agent (final summary without tool_use noise)
          summaryText = result.resultText || filesStr;
        } else {
          summaryText = `Code modification failed: ${result.error || 'Unknown error'}`;
        }

        // Persist Code Agent response
        const coderMsg: StoredMessage = {
          id: `msg_${Date.now()}_coder`,
          role: 'coder',
          content: summaryText,
          timestamp: new Date().toISOString(),
        };
        appendMessage(projectPath, coderMsg);

        // Auto-trigger build on success
        if (result.success && result.changedFiles.length > 0) {
          sendEvent({ type: 'tool-call', toolCallId: 'build_auto', toolName: 'trigger_build' });
          const buildResult = await refreshPreview(win);
          sendEvent({ type: 'tool-result', toolCallId: 'build_auto' });
          console.log('[coder:send] Auto-build: %s', buildResult.success ? 'success' : 'failed');
        }

        sendEvent({ type: 'done', text: summaryText });

        return {
          success: result.success,
          text: summaryText,
          changedFiles: result.changedFiles,
          error: result.error,
        };
      } catch (err: any) {
        console.error('[coder:send] Error:', err.message);
        sendEvent({ type: 'done' });
        return { success: false, error: err.message };
      }
    },
  );

  /** Detect the currently configured coder agent (from cache) */
  ipcMain.handle('coder:detect', async () => {
    const config = readConfig();
    const env = getEnvStatus();
    return env.coderAgents.find(a => a.agentId === config.coderAgent) || env.coderAgents[0];
  });

  /** Detect all available coder agents (from cache) */
  ipcMain.handle('coder:detect-all', async () => {
    return getEnvStatus().coderAgents;
  });
}
