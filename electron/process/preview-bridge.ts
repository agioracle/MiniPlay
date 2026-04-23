import { BrowserWindow } from 'electron';
import { runH5Build } from './build-manager';
import { startVitePreview, stopVitePreview } from './vite-manager';
import { parseBuildError } from './error-parser';
import { selfHeal } from './self-heal';
import { getActiveProject } from '../project/state';

/**
 * Refresh the preview for a specific project.
 *
 * **Explicit-projectPath contract**: callers MUST pass the project they want
 * refreshed. This function never calls `getActiveProject()` internally
 * because it may be invoked for BACKGROUND projects (via
 * `autoBuildAfterCoder` after a background Coder run finishes). Relying on
 * the foreground active project at event-emission time would misroute
 * preview events to the wrong project.
 *
 * **Build/serve decoupling**:
 *  - The H5 build ALWAYS runs for `projectPath` (refreshing `dist-h5/`).
 *  - The Vite/static preview server is only (re)started when
 *    `projectPath === getActiveProject()` — only the foreground project
 *    serves a preview. For background projects we emit
 *    `preview:status { status: 'built-idle', projectPath }` instead; the UI
 *    can then light up a "built, not served" indicator and `project:open`
 *    will reuse the built artefacts via `project:resume-preview`.
 *
 * All `preview:status` / `preview:refresh` / runtime-error events emitted
 * from this module carry `projectPath` so the LiveView can filter.
 */
export async function refreshPreview(
  projectPath: string,
  win?: BrowserWindow,
): Promise<{
  success: boolean;
  url?: string;
  error?: string;
  buildDuration?: number;
  selfHealed?: boolean;
  builtIdle?: boolean;
}> {
  if (!projectPath) {
    return { success: false, error: 'refreshPreview called without projectPath' };
  }

  const mainWin = win || BrowserWindow.getAllWindows()[0];
  const sendStatus = (payload: Record<string, unknown>) => {
    mainWin?.webContents.send('preview:status', { ...payload, projectPath });
  };

  // Step 1: Build H5 (runs for background projects too — keeps dist-h5 fresh)
  sendStatus({ status: 'building' });

  const buildResult = await runH5Build(projectPath);

  if (!buildResult.success) {
    const errors = parseBuildError(buildResult.error || buildResult.output);

    if (errors.length > 0) {
      sendStatus({ status: 'self-healing', error: errors[0]?.message });

      const healResult = await selfHeal({
        errors,
        projectPath,
        win: mainWin || undefined,
      });

      if (healResult.success) {
        // Self-heal succeeded — the healing path already started the server
        // when foreground. Determine URL for foreground case.
        const isForeground = projectPath === getActiveProject();
        return {
          success: true,
          url: isForeground ? 'http://localhost:5173' : undefined,
          buildDuration: buildResult.duration,
          selfHealed: true,
          builtIdle: !isForeground,
        };
      }

      const errorSummary = (healResult.finalErrors || errors)
        .map(e => e.message)
        .join('; ');
      sendStatus({
        status: 'build-failed',
        error: `Auto-fix failed after ${healResult.attempts} attempts: ${errorSummary}`,
      });
      return {
        success: false,
        error: errorSummary,
        buildDuration: buildResult.duration,
      };
    }

    sendStatus({ status: 'build-failed', error: buildResult.error });
    return {
      success: false,
      error: buildResult.error,
      buildDuration: buildResult.duration,
    };
  }

  // Step 2: (Re)start the preview server only when this is the foreground
  // project. Background projects get `built-idle` instead.
  const isForeground = projectPath === getActiveProject();
  if (!isForeground) {
    sendStatus({ status: 'built-idle' });
    return {
      success: true,
      buildDuration: buildResult.duration,
      builtIdle: true,
    };
  }

  sendStatus({ status: 'starting-server' });

  try {
    const url = await startVitePreview(projectPath);

    sendStatus({ status: 'ready', url });
    mainWin?.webContents.send('preview:refresh', { url, projectPath });

    return {
      success: true,
      url,
      buildDuration: buildResult.duration,
    };
  } catch (err: any) {
    sendStatus({ status: 'server-failed', error: err.message });
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
