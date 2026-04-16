import { ipcMain, BrowserWindow } from 'electron';
import { refreshPreview, teardownPreview } from '../process/preview-bridge';
import { getPreviewState } from '../process/vite-manager';
import { parseRuntimeError } from '../process/error-parser';
import { selfHeal } from '../process/self-heal';
import { getActiveProject } from '../project/state';

export function registerPreviewHandlers() {
  /** Trigger a build + preview refresh */
  ipcMain.handle('preview:refresh', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || undefined;
    return refreshPreview(win);
  });

  /** Get current preview state */
  ipcMain.handle('preview:state', async () => {
    return getPreviewState();
  });

  /** Stop the preview server */
  ipcMain.handle('preview:stop', async () => {
    await teardownPreview();
    return { success: true };
  });

  /**
   * Handle runtime errors reported from the preview iframe.
   * The renderer captures these via postMessage and forwards here.
   */
  ipcMain.handle(
    'preview:runtime-error',
    async (event, errorData: { message?: string; source?: string; line?: number; stack?: string }) => {
      const projectPath = getActiveProject();
      if (!projectPath) return { handled: false };

      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      const error = parseRuntimeError(errorData);

      // Attempt self-healing
      const result = await selfHeal({
        errors: [error],
        projectPath,
        win: win || undefined,
      });

      return {
        handled: result.success,
        attempts: result.attempts,
      };
    },
  );
}
