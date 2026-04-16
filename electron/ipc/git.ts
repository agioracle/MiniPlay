import { ipcMain, BrowserWindow } from 'electron';
import { autoCommit } from '../git/auto-commit';
import { checkoutVersion, returnToLatest } from '../git/time-travel';
import { readVersions, addVersion, getNextVersionLabel } from '../git/version-manager';
import { refreshPreview } from '../process/preview-bridge';
import { getActiveProject } from '../project/state';

export function registerGitHandlers() {
  /** Get version list for a project */
  ipcMain.handle('git:versions', async (_event, projectPath?: string) => {
    const dir = projectPath || getActiveProject();
    if (!dir) return { versions: [] };
    return readVersions(dir);
  });

  /**
   * Commit current changes and record a version.
   * Called automatically after successful build.
   */
  ipcMain.handle(
    'git:commit',
    async (_event, payload: { summary: string; changedFiles?: string[]; triggerMessageId?: string }) => {
      const projectPath = getActiveProject();
      if (!projectPath) return { error: 'No active project' };

      const versionLabel = getNextVersionLabel(projectPath);
      const commitResult = autoCommit(projectPath, payload.summary);

      if (commitResult.success && commitResult.commitHash) {
        addVersion(projectPath, {
          version: versionLabel,
          commitHash: commitResult.commitHash,
          summary: payload.summary,
          gddSectionsChanged: [],
          filesChanged: payload.changedFiles || [],
          triggerMessageId: payload.triggerMessageId || null,
          ts: new Date().toISOString(),
        });
      }

      return { ...commitResult, version: versionLabel };
    },
  );

  /** Time travel: checkout a specific version */
  ipcMain.handle('git:checkout', async (event, commitHash: string) => {
    const projectPath = getActiveProject();
    if (!projectPath) return { error: 'No active project' };

    const result = checkoutVersion(projectPath, commitHash);
    if (result.success) {
      // Rebuild and refresh preview at this version
      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      await refreshPreview(win);
    }

    return result;
  });

  /** Time travel: return to latest */
  ipcMain.handle('git:return-to-latest', async (event) => {
    const projectPath = getActiveProject();
    if (!projectPath) return { error: 'No active project' };

    const result = returnToLatest(projectPath);
    if (result.success) {
      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      await refreshPreview(win);
    }

    return result;
  });
}
