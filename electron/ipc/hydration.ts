import { ipcMain, BrowserWindow } from 'electron';
import { runHydration, isHydrationComplete } from '../hydration/index';
import { getEnvStatus } from '../hydration/env-cache';

export function registerHydrationHandlers() {
  ipcMain.handle('hydration:check', async () => {
    return isHydrationComplete();
  });

  ipcMain.handle('hydration:run', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    return runHydration(win);
  });

  /** Return cached environment detection results */
  ipcMain.handle('env:status', async () => {
    return getEnvStatus();
  });
}
