import { execSync } from 'child_process';

/**
 * Checkout a specific commit (detached HEAD) for time travel preview.
 */
export function checkoutVersion(projectPath: string, commitHash: string): {
  success: boolean;
  error?: string;
} {
  try {
    execSync(`git checkout ${commitHash}`, {
      cwd: projectPath,
      timeout: 10000,
      stdio: 'pipe',
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Return to the latest commit (main/master branch HEAD).
 */
export function returnToLatest(projectPath: string): {
  success: boolean;
  error?: string;
} {
  try {
    // Try common branch names
    for (const branch of ['main', 'master']) {
      try {
        execSync(`git checkout ${branch}`, {
          cwd: projectPath,
          timeout: 10000,
          stdio: 'pipe',
        });
        return { success: true };
      } catch {
        // Try next branch name
      }
    }

    // Fallback: checkout the branch that has the most recent commit
    const branch = execSync('git branch --sort=-committerdate --format="%(refname:short)"', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim().split('\n')[0];

    if (branch) {
      execSync(`git checkout ${branch}`, {
        cwd: projectPath,
        timeout: 10000,
        stdio: 'pipe',
      });
      return { success: true };
    }

    return { success: false, error: 'No branch found' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Get the list of all commits (for time travel display).
 */
export function getCommitLog(projectPath: string): Array<{
  hash: string;
  message: string;
  date: string;
}> {
  try {
    const output = execSync(
      'git log --pretty=format:"%h|||%s|||%ci" --reverse',
      {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 10000,
      },
    ).trim();

    if (!output) return [];

    return output.split('\n').map(line => {
      const [hash, message, date] = line.split('|||');
      return { hash, message, date };
    });
  } catch {
    return [];
  }
}
