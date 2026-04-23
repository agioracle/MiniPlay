import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { runCoderAgent } from '../coder/coder-runner';
import { getActiveProject } from '../project/state';
import { getEnvStatus } from '../hydration/env-cache';
import { readConfig } from '../storage/config';
import { autoBuildAfterCoder } from '../process/auto-build';
import { appendMessage, type StoredMessage } from '../agent/message-store';
import { coderSessionManager } from '../coder/session-manager';

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
    async (event, payload: { summary: string; projectPath?: string }) => {
      const projectPath = payload.projectPath || getActiveProject();
      if (!projectPath) return { error: 'No active project' };

      const win = BrowserWindow.fromWebContents(event.sender);

      const result = await runCoderAgent({
        projectPath,
        summary: payload.summary,
        onStatus: (status) => {
          if (win) {
            // Legacy status channel kept for backwards compat. Coder-related
            // agent:stream events still flow through session-manager via
            // runCoderAgent's internal emissions.
            win.webContents.send('coder:status', { status, projectPath });
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
   *
   * ProjectPath resolution: caller may pass an explicit `projectPath` (useful
   * when the renderer wants to queue work into a specific project while
   * viewing another one). Falls back to the currently-active project.
   */
  ipcMain.handle(
    'coder:send',
    async (event, payload: { message: string; images?: ImageData[]; projectPath?: string }) => {
      const projectPath = payload.projectPath || getActiveProject();
      if (!projectPath) {
        return { success: false, error: 'No active project. Create a project first.' };
      }

      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { success: false, error: 'No window' };

      console.log('[coder:send] Message: %s', payload.message.slice(0, 100));
      console.log('[coder:send] Target project: %s', projectPath);

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

      // Globally-unique batchId assigned by the session manager. Replaces the
      // legacy `coder_${Date.now()}` scheme which collided in parallel-project
      // workloads within the same millisecond.
      const batchId = coderSessionManager.startBatch(projectPath);

      const emit = (type: Parameters<typeof coderSessionManager.emitEvent>[1]['type'], payload: Record<string, unknown>) => {
        coderSessionManager.emitEvent(projectPath, {
          batchId,
          type,
          payload,
        });
      };

      const onStatus = (status: string) => {
        emit('status', { text: status });
      };

      // Collect Code Agent's text output for summary
      const outputLines: string[] = [];
      const onOutput = (line: string) => {
        emit('output', { text: line });
        outputLines.push(line);
      };

      try {
        const result = await runCoderAgent({
          projectPath,
          summary: messageWithImages,
          onStatus,
          onOutput,
          onDequeue: () => {
            // Register the batchId and emit the first user-visible events
            // ONLY when the queue actually hands control to this task. Doing
            // it at IPC entry would let a second same-project send overwrite
            // `currentBatchId` while the first task is still running, causing
            // `coder:cancel` to mis-attribute the `__cancelled` marker.
            coderSessionManager.setCurrentBatchId(projectPath, batchId);
            emit('tool-call', { toolCallId: batchId, toolName: 'send_to_coder' });
            onStatus('launching');
          },
        });

        onStatus(result.success ? 'done' : 'failed');
        emit('tool-result', { toolCallId: batchId });

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

        // Auto-trigger build on success. We no longer gate on
        // `changedFiles.length > 0` — see plan fix-rebuild-not-triggered-after-coder.
        if (result.success) {
          await autoBuildAfterCoder({
            projectPath,
            win,
            batchId,
            toolCallId: 'build_auto',
          });
        }

        emit('status', { text: summaryText, __done: true });

        return {
          success: result.success,
          text: summaryText,
          changedFiles: result.changedFiles,
          error: result.error,
        };
      } catch (err: any) {
        console.error('[coder:send] Error:', err.message);
        emit('status', { text: err.message || 'failed', __done: true });
        return { success: false, error: err.message };
      }
    },
  );

  /**
   * Cancel the project's running Coder task (SIGTERM → 3s → SIGKILL) and drop
   * all pending tasks for the same project. Preserves the CoderBuffer so the
   * UI can still show the transcript, and does not delete the
   * `.miniplay/coder-session.json` file (so `--resume` still works).
   *
   * Product semantics: cancel is scoped to the **currently active (foreground)
   * project only**. If `payload.projectPath` is provided and does not match
   * the active project, the request is rejected with
   * `{ cancelled: false, error: 'not-active-project' }`. This narrows the
   * surface area so a misbehaving or compromised renderer cannot remotely
   * cancel work on arbitrary background projects.
   */
  ipcMain.handle(
    'coder:cancel',
    async (_event, payload: { projectPath?: string } | undefined) => {
      const activeProject = getActiveProject();

      // Reject cross-project cancel attempts: only the foreground project may
      // be cancelled. Falls through to activeProject when caller omits the
      // field (the common ChatPanel path).
      if (payload?.projectPath && payload.projectPath !== activeProject) {
        return { cancelled: false, error: 'not-active-project' };
      }

      const projectPath = payload?.projectPath || activeProject;
      if (!projectPath) return { cancelled: false, error: 'No project' };

      // Mark the cancel into the buffer so the UI shows a cancelled status
      // pill for the current batch (if any).
      const session = coderSessionManager.getSession(projectPath);
      const currentBatch = session?.currentBatchId ?? null;
      if (currentBatch) {
        coderSessionManager.emitEvent(projectPath, {
          batchId: currentBatch,
          type: 'status',
          payload: { text: 'cancelled', __done: true, __cancelled: true },
        });
      }

      const res = await coderSessionManager.cancel(projectPath);
      return res;
    },
  );

  /**
   * Return a snapshot of the project's CoderBuffer so a newly-mounted renderer
   * can replay history. Caller MUST register its `agent:stream` listener BEFORE
   * calling subscribe, then use `lastSeq` to dedupe with live events.
   */
  ipcMain.handle(
    'coder:subscribe',
    async (_event, payload: { projectPath?: string } | undefined) => {
      const projectPath = payload?.projectPath || getActiveProject();
      if (!projectPath) return { events: [], lastSeq: 0, batches: [] };
      const snapshot = coderSessionManager.getSnapshot(projectPath);
      if (!snapshot) return { events: [], lastSeq: 0, batches: [] };
      return snapshot;
    },
  );

  /**
   * Synchronous listing of running project paths. Used by the home page to
   * hydrate badges on first render before `coder:running-changed` fires.
   */
  ipcMain.handle('coder:running-list', async () => {
    return { runningPaths: coderSessionManager.listRunning() };
  });

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
