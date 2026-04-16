import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { refreshPreview } from '../../process/preview-bridge';

export const triggerBuildTool = tool({
  description: 'Trigger an H5 build to refresh the preview. ONLY call this AFTER send_to_coder succeeds (returns success: true). Do NOT call if send_to_coder failed.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    console.log('[trigger_build] Starting H5 build...');
    try {
      const result = await refreshPreview();
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
