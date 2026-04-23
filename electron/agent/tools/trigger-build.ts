import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { refreshPreview } from '../../process/preview-bridge';
import { getActiveProject } from '../../project/state';

export const triggerBuildTool = tool({
  description: 'Manual rebuild only. Call this ONLY when the user explicitly asks to rebuild / refresh preview / 重新构建 / 刷新预览 / 重新编译. Do NOT call this in the normal create-or-iterate flow — build runs automatically after send_to_coder succeeds.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    console.log('[trigger_build] Starting H5 build...');
    const projectPath = getActiveProject();
    if (!projectPath) {
      return {
        success: false,
        buildTime: '0s',
        previewUrl: null,
        message: 'No active project — cannot build.',
      };
    }
    try {
      const result = await refreshPreview(projectPath);
      console.log('[trigger_build] Build %s. Duration: %dms, URL: %s', result.success ? 'succeeded' : 'failed', result.buildDuration || 0, result.url || '(none)');

      if (result.success) {
        return {
          success: true,
          buildTime: `${((result.buildDuration || 0) / 1000).toFixed(1)}s`,
          previewUrl: result.url,
          message: `H5 build completed in ${((result.buildDuration || 0) / 1000).toFixed(1)}s. Preview refreshed at ${result.url}`,
        };
      } else {
        return {
          success: false,
          buildTime: `${((result.buildDuration || 0) / 1000).toFixed(1)}s`,
          previewUrl: null,
          message: `Build failed: ${result.error}`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        buildTime: '0s',
        previewUrl: null,
        message: `Build error: ${err.message}`,
      };
    }
  },
});
