import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { readProjectsIndex, removeProject } from '../storage/projects';
import { readMessages } from '../agent/message-store';
import { readGdd, writeGdd } from '../project/gdd';
import { setActiveProject, getActiveProject } from '../project/state';
import { refreshPreview } from '../process/preview-bridge';
import { startVitePreview, stopVitePreview } from '../process/vite-manager';
import { coderSessionManager } from '../coder/session-manager';

export function registerProjectHandlers() {
  /** List all projects */
  ipcMain.handle('project:list', async () => {
    const index = readProjectsIndex();
    // Filter out projects whose directories no longer exist
    return index.projects.filter(p => fs.existsSync(p.path));
  });

  /**
   * Open/activate a project — promotes `projectPath` to the foreground.
   *
   * Returns `hasRunningCoder` so the renderer knows to immediately call
   * `coder:subscribe` to replay in-flight log history from the CoderBuffer.
   */
  ipcMain.handle('project:open', async (_event, projectPath: string) => {
    if (!fs.existsSync(projectPath)) {
      return { error: 'Project directory not found' };
    }
    setActiveProject(projectPath);

    // Load conversation history
    const messages = readMessages(projectPath);

    // Load GDD
    const gdd = readGdd(projectPath);

    // Load versions
    const versionsPath = `${projectPath}/.miniplay/versions.json`;
    let versions = { versions: [] };
    if (fs.existsSync(versionsPath)) {
      try {
        versions = JSON.parse(fs.readFileSync(versionsPath, 'utf-8'));
      } catch {}
    }

    const runningProjects = coderSessionManager.listRunning();
    const hasRunningCoder = runningProjects.includes(projectPath);

    return {
      projectPath,
      messages,
      gdd,
      versions,
      hasRunningCoder,
    };

    // NOTE: preview is triggered asynchronously AFTER returning data to renderer,
    // so the UI can show messages immediately while preview loads in background.
  });

  /**
   * Auto-launch preview after project:open completes.
   * Fired from renderer once workspace view is ready.
   *
   * `projectPath` is REQUIRED here — legacy callers (without arg) can still
   * hit this because we fall back to the active project, but that path is
   * only safe when this is the foreground project, which is always the case
   * immediately after `project:open`.
   */
  ipcMain.handle(
    'project:resume-preview',
    async (event, payload: { projectPath?: string } | undefined) => {
      const projectPath = payload?.projectPath || getActiveProject();
      if (!projectPath) return { success: false, error: 'No active project' };

      const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getAllWindows()[0];
      const distH5 = path.join(projectPath, 'dist-h5');
      const indexHtml = path.join(distH5, 'index.html');

      // Fast path: if `dist-h5` already has a built `index.html`, only start
      // the static server when this is the foreground project. Background
      // projects emit `built-idle` — the renderer will re-trigger
      // resume-preview when the user switches back.
      if (fs.existsSync(indexHtml)) {
        const isForeground = projectPath === getActiveProject();
        if (!isForeground) {
          win?.webContents.send('preview:status', { status: 'built-idle', projectPath });
          return { success: true, builtIdle: true };
        }
        try {
          win?.webContents.send('preview:status', { status: 'starting-server', projectPath });
          const url = await startVitePreview(projectPath);
          win?.webContents.send('preview:status', { status: 'ready', url, projectPath });
          win?.webContents.send('preview:refresh', { url, projectPath });
          return { success: true, url };
        } catch {
          // Fall through to full rebuild
        }
      }

      // No cached build — do full build + serve (serve only if foreground).
      const result = await refreshPreview(projectPath, win || undefined);
      return result;
    },
  );

  /** Get active project path */
  ipcMain.handle('project:active', async () => {
    return getActiveProject();
  });

  /**
   * Deactivate the current foreground project — used when the user returns
   * to the home page or switches to a different project. This is the "leave
   * but keep running" semantics:
   *   - Clears the active-project flag (so foreground events stop routing here).
   *   - Stops the Vite preview server (serve is a foreground-only resource).
   *   - **Does NOT touch the CoderSession** — any in-flight Coder task continues
   *     running in the background, accumulating events in its CoderBuffer.
   *
   * The renderer can later call `project:open` + `project:resume-preview` to
   * return to a full foreground state, and `coder:subscribe` to replay the
   * buffer.
   */
  ipcMain.handle('project:deactivate', async () => {
    setActiveProject(null);
    await stopVitePreview();
    return { success: true };
  });

  /**
   * Explicitly close the current project (stronger than deactivate):
   *   - Deactivate (clear foreground + stop preview).
   *   - **Kill the project's CoderSession** (SIGTERM → SIGKILL), clear its
   *     buffer, and remove it from the session map.
   *
   * This is invoked from a user-facing "Close project" action, as opposed
   * to the implicit leave triggered by going home. Files on disk are NOT
   * deleted — use `project:delete` for that.
   */
  ipcMain.handle('project:close', async (_event, payload: { projectPath?: string } | undefined) => {
    const target = payload?.projectPath || getActiveProject();
    if (target === getActiveProject()) {
      setActiveProject(null);
      await stopVitePreview();
    }
    if (target) {
      await coderSessionManager.closeSession(target);
    }
    return { success: true };
  });

  /**
   * Delete a project — routes through `closeSession` BEFORE touching the
   * filesystem. This is critical: if we deleted the directory while a
   * coder-cli child is still writing into it, we'd hit a classic
   * write-after-unlink race that leaves orphaned temp files and corrupted
   * session state.
   */
  ipcMain.handle('project:delete', async (_event, projectPath: string) => {
    try {
      // If deleting the active project, clear it first and stop preview
      if (getActiveProject() === projectPath) {
        setActiveProject(null);
        await stopVitePreview();
      }
      // Always close the CoderSession (kills children + clears buffer).
      await coderSessionManager.closeSession(projectPath);
      removeProject(projectPath);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /** Read GDD content for the active project */
  ipcMain.handle('gdd:read', async () => {
    const projectPath = getActiveProject();
    if (!projectPath) return { content: '', error: 'No active project' };
    return { content: readGdd(projectPath) };
  });

  /** Write GDD content for the active project */
  ipcMain.handle('gdd:write', async (_event, content: string) => {
    const projectPath = getActiveProject();
    if (!projectPath) return { success: false, error: 'No active project' };
    try {
      writeGdd(projectPath, content);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
