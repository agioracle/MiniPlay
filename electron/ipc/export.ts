import { ipcMain, BrowserWindow, dialog } from 'electron';
import { runWxBuild } from '../export/wx-build';
import { zipDistWx } from '../export/zip-packager';
import { checkDistSize } from '../export/size-checker';
import { getActiveProject } from '../project/state';
import * as fs from 'fs';
import * as path from 'path';

export function registerExportHandlers() {
  /**
   * Read export config: appid, cdn from phaser-wx.config.json,
   * and whether remote-assets exist.
   */
  ipcMain.handle('export:config', async () => {
    const projectPath = getActiveProject();
    if (!projectPath) return { error: 'No active project' };

    const configPath = path.join(projectPath, 'phaser-wx.config.json');
    let appid = '';
    let cdn = '';

    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        appid = config.appid || '';
        cdn = config.cdn || '';
      } catch {}
    }

    // Check if remote-assets directories have files
    const remoteAudioDir = path.join(projectPath, 'public', 'remote-assets', 'audio');
    const remoteImagesDir = path.join(projectPath, 'public', 'remote-assets', 'images');
    const hasRemoteAssets = (
      (fs.existsSync(remoteAudioDir) && fs.readdirSync(remoteAudioDir).filter(f => !f.startsWith('.')).length > 0) ||
      (fs.existsSync(remoteImagesDir) && fs.readdirSync(remoteImagesDir).filter(f => !f.startsWith('.')).length > 0)
    );

    return { appid, cdn, hasRemoteAssets };
  });

  /**
   * Full export flow: write config → build wx → check size → zip → save dialog.
   */
  ipcMain.handle('export:run', async (event, payload?: { appid?: string; cdn?: string }) => {
    const projectPath = getActiveProject();
    if (!projectPath) return { error: 'No active project' };

    const win = BrowserWindow.fromWebContents(event.sender);

    // Write appid and cdn to phaser-wx.config.json before building
    if (payload?.appid || payload?.cdn) {
      const configPath = path.join(projectPath, 'phaser-wx.config.json');
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (payload.appid) config.appid = payload.appid;
          if (payload.cdn !== undefined) config.cdn = payload.cdn;
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        } catch {}
      }
    }

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
