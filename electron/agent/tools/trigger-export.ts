import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { dialog } from 'electron';
import { runWxBuild } from '../../export/wx-build';
import { zipDistWx } from '../../export/zip-packager';
import { checkDistSize } from '../../export/size-checker';
import { getActiveProject } from '../../project/state';
import * as fs from 'fs';
import * as path from 'path';

export const triggerExportTool = tool({
  description: 'Export the game as a WeChat mini-game .zip package. Call this when the user is satisfied and wants to publish. You MUST ask the user for their WeChat appid and CDN address (optional, can be empty) before calling this tool.',
  inputSchema: zodSchema(z.object({
    appid: z.string().describe('WeChat mini-game appid, e.g. "wx1234567890abcdef". Ask the user for this.'),
    cdn: z.string().optional().describe('CDN base URL for remote assets. Empty string if not using CDN. Ask the user for this (can be left empty).'),
  })),
  execute: async (input) => {
    const projectPath = getActiveProject();
    if (!projectPath) {
      return {
        success: false,
        message: 'No active project. Create a project first.',
      };
    }

    try {
      // Write appid and cdn to phaser-wx.config.json before building
      const configPath = path.join(projectPath, 'phaser-wx.config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.appid = input.appid;
        config.cdn = input.cdn || '';
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      }

      // Step 1: Build for WeChat target
      const buildResult = await runWxBuild(projectPath);
      if (!buildResult.success) {
        return {
          success: false,
          message: `WeChat build failed: ${buildResult.error}`,
        };
      }

      // Step 2: Check sizes
      const sizeReport = checkDistSize(projectPath);
      if (sizeReport.status === 'blocked') {
        const topFiles = sizeReport.topFiles
          ?.map(f => `  ${f.file}: ${(f.size / 1024 / 1024).toFixed(1)}MB`)
          .join('\n') || '';
        return {
          success: false,
          message: `Export blocked: ${sizeReport.message}\n\nLargest files:\n${topFiles}`,
        };
      }

      // Step 3: Zip
      const zipResult = zipDistWx(projectPath);
      if (!zipResult.success) {
        return {
          success: false,
          message: `Failed to create zip: ${zipResult.error}`,
        };
      }

      // Step 4: Show save dialog
      const { filePath: savePath } = await dialog.showSaveDialog({
        defaultPath: zipResult.zipPath,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        title: 'Save WeChat Mini-Game Package',
      });

      if (savePath && savePath !== zipResult.zipPath) {
        fs.copyFileSync(zipResult.zipPath!, savePath);
      }

      const sizeMB = ((zipResult.size || 0) / 1024 / 1024).toFixed(1);
      const warningNote = sizeReport.status === 'warning'
        ? `\n\n⚠️ ${sizeReport.message}`
        : '';

      return {
        success: true,
        zipSize: `${sizeMB} MB`,
        savedTo: savePath || zipResult.zipPath,
        message: `WeChat mini-game exported (${sizeMB}MB). ${savePath ? `Saved to ${savePath}` : `File at ${zipResult.zipPath}`}. Unzip and open in WeChat DevTools to preview.${warningNote}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Export error: ${err.message}`,
      };
    }
  },
});
