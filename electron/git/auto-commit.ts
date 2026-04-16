import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Auto-commit all changes in the project with a semantic version message.
 * Returns the commit hash and version number.
 */
export function autoCommit(projectPath: string, summary: string): {
  success: boolean;
  commitHash?: string;
  error?: string;
} {
  try {
    // Check if there are any changes to commit
    const status = execSync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (!status) {
      return { success: true, commitHash: getCurrentCommitHash(projectPath) };
    }

    // Stage all changes
    execSync('git add -A', {
      cwd: projectPath,
      timeout: 10000,
      stdio: 'pipe',
    });

    // Get next version number
    const versionNum = getNextVersionNumber(projectPath);

    // Commit
    const message = `v${versionNum}: ${summary}`;
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: projectPath,
      timeout: 10000,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'MiniPlay',
        GIT_AUTHOR_EMAIL: 'miniplay@local',
        GIT_COMMITTER_NAME: 'MiniPlay',
        GIT_COMMITTER_EMAIL: 'miniplay@local',
      },
    });

    const commitHash = getCurrentCommitHash(projectPath);
    return { success: true, commitHash };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Get the current HEAD commit hash.
 */
export function getCurrentCommitHash(projectPath: string): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Get the next version number by counting existing commits.
 */
function getNextVersionNumber(projectPath: string): number {
  try {
    const count = execSync('git rev-list --count HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return parseInt(count, 10) + 1;
  } catch {
    return 1;
  }
}
