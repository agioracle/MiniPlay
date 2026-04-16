import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { readProjectsIndex, removeProject } from '../storage/projects';
import { readMessages } from '../agent/message-store';
import { readGdd, writeGdd } from '../project/gdd';
import { setActiveProject, getActiveProject } from '../project/state';
import { refreshPreview } from '../process/preview-bridge';
import { startVitePreview } from '../process/vite-manager';

export function registerProjectHandlers() {
  /** List all projects */
  ipcMain.handle('project:list', async () => {
    const index = readProjectsIndex();
    // Filter out projects whose directories no longer exist
    return index.projects.filter(p => fs.existsSync(p.path));
  });

  /** Open/activate a project */
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

    return {
      projectPath,
      messages,
      gdd,
      versions,
    };

    // NOTE: preview is triggered asynchronously AFTER returning data to renderer,
    // so the UI can show messages immediately while preview loads in background.
  });

  /**
   * Auto-launch preview after project:open completes.
   * Fired from renderer once workspace view is ready.
   */
  ipcMain.handle('project:resume-preview', async () => {
    const projectPath = getActiveProject();
    if (!projectPath) return { success: false, error: 'No active project' };

    const win = BrowserWindow.getAllWindows()[0];
    const distH5 = path.join(projectPath, 'dist-h5');
    const indexHtml = path.join(distH5, 'index.html');

    // If dist-h5 already has a built index.html, just start the static server (fast)
    if (fs.existsSync(indexHtml)) {
      try {
        win?.webContents.send('preview:status', { status: 'starting-server' });
        const url = await startVitePreview(projectPath);
        win?.webContents.send('preview:status', { status: 'ready', url });
        win?.webContents.send('preview:refresh', { url });
        return { success: true, url };
      } catch (err: any) {
        // Fall through to full rebuild
      }
    }

    // No cached build — do full build + serve
    const result = await refreshPreview(win);
    return result;
  });

  /** Get active project path */
  ipcMain.handle('project:active', async () => {
    return getActiveProject();
  });

  /** Close/deactivate the current project — clears state and stops preview */
  ipcMain.handle('project:close', async () => {
    setActiveProject(null);
    const { stopVitePreview } = await import('../process/vite-manager');
    await stopVitePreview();
    return { success: true };
  });

  /** Delete a project — removes from index and deletes directory */
  ipcMain.handle('project:delete', async (_event, projectPath: string) => {
    try {
      // If deleting the active project, clear it
      if (getActiveProject() === projectPath) {
        setActiveProject(null);
      }
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
