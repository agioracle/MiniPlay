import { BrowserWindow } from 'electron';
import { runH5Build } from './build-manager';
import { startVitePreview, stopVitePreview } from './vite-manager';
import { parseBuildError } from './error-parser';
import { selfHeal } from './self-heal';
import { getActiveProject } from '../project/state';

/**
 * Full preview cycle: build H5 → start/restart preview server → notify renderer.
 * If build fails, automatically triggers self-healing (up to 3 retries).
 */
export async function refreshPreview(win?: BrowserWindow): Promise<{
  success: boolean;
  url?: string;
  error?: string;
  buildDuration?: number;
  selfHealed?: boolean;
}> {
  const projectPath = getActiveProject();
  if (!projectPath) {
    return { success: false, error: 'No active project' };
  }

  const mainWin = win || BrowserWindow.getAllWindows()[0];

  // Step 1: Build H5
  mainWin?.webContents.send('preview:status', { status: 'building' });

  const buildResult = await runH5Build(projectPath);

  if (!buildResult.success) {
    // Parse errors and attempt self-healing
    const errors = parseBuildError(buildResult.error || buildResult.output);

    if (errors.length > 0) {
      mainWin?.webContents.send('preview:status', {
        status: 'self-healing',
        error: errors[0]?.message,
      });

      const healResult = await selfHeal({
        errors,
        projectPath,
        win: mainWin || undefined,
      });

      if (healResult.success) {
        return {
          success: true,
          url: `http://localhost:5173`,
          buildDuration: buildResult.duration,
          selfHealed: true,
        };
      }

      // Self-healing failed — report to user
      const errorSummary = (healResult.finalErrors || errors)
        .map(e => e.message)
        .join('; ');
      mainWin?.webContents.send('preview:status', {
        status: 'build-failed',
        error: `Auto-fix failed after ${healResult.attempts} attempts: ${errorSummary}`,
      });
      return {
        success: false,
        error: errorSummary,
        buildDuration: buildResult.duration,
      };
    }

    mainWin?.webContents.send('preview:status', {
      status: 'build-failed',
      error: buildResult.error,
    });
    return {
      success: false,
      error: buildResult.error,
      buildDuration: buildResult.duration,
    };
  }

  // Step 2: Start/restart preview server
  mainWin?.webContents.send('preview:status', { status: 'starting-server' });

  try {
    const url = await startVitePreview(projectPath);

    mainWin?.webContents.send('preview:status', { status: 'ready', url });
    mainWin?.webContents.send('preview:refresh', { url });

    return {
      success: true,
      url,
      buildDuration: buildResult.duration,
    };
  } catch (err: any) {
    mainWin?.webContents.send('preview:status', {
      status: 'server-failed',
      error: err.message,
    });
    return {
      success: false,
      error: `Preview server failed: ${err.message}`,
      buildDuration: buildResult.duration,
    };
  }
}

/**
 * Stop the preview server (e.g. when closing a project).
 */
export async function teardownPreview(): Promise<void> {
  await stopVitePreview();
}
