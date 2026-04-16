import { ipcMain, BrowserWindow, dialog } from 'electron';
import { runWxBuild } from '../export/wx-build';
import { zipDistWx } from '../export/zip-packager';
import { checkDistSize } from '../export/size-checker';
import { getActiveProject } from '../project/state';
import * as fs from 'fs';

export function registerExportHandlers() {
  /**
   * Full export flow: build wx → check size → zip → save dialog.
   */
  ipcMain.handle('export:run', async (event) => {
    const projectPath = getActiveProject();
    if (!projectPath) return { error: 'No active project' };

    const win = BrowserWindow.fromWebContents(event.sender);

    // Build
    win?.webContents.send('export:status', { step: 'building' });
    const buildResult = await runWxBuild(projectPath);
    if (!buildResult.success) {
      return { error: `Build failed: ${buildResult.error}` };
    }

    // Size check
    win?.webContents.send('export:status', { step: 'checking-size' });
    const sizeReport = checkDistSize(projectPath);
    if (sizeReport.status === 'blocked') {
      return { error: sizeReport.message, topFiles: sizeReport.topFiles };
    }

    // Zip
    win?.webContents.send('export:status', { step: 'packaging' });
    const zipResult = zipDistWx(projectPath);
    if (!zipResult.success) {
      return { error: `Zip failed: ${zipResult.error}` };
    }

    // Save dialog
    const { filePath: savePath } = await dialog.showSaveDialog({
      defaultPath: zipResult.zipPath,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
      title: 'Save WeChat Mini-Game Package',
    });

    if (savePath && savePath !== zipResult.zipPath) {
      fs.copyFileSync(zipResult.zipPath!, savePath);
    }

    win?.webContents.send('export:status', { step: 'done' });

    return {
      success: true,
      zipPath: savePath || zipResult.zipPath,
      size: zipResult.size,
      sizeReport,
    };
  });
}
