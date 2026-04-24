import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  PHASER_WX_REPO_DIR,
  PHASER_WX_CLI_DIR,
  ensurePnpm,
  buildAndLinkPhaserWx,
} from './install-phaser-wx';

export type UpdateStatus =
  | 'skipped-no-repo'
  | 'skipped-no-network'
  | 'skipped-no-git'
  | 'skipped-dirty'
  | 'up-to-date'
  | 'updating'
  | 'updated'
  | 'failed-rollback'
  | 'failed';

export interface UpdateProgress {
  status: UpdateStatus;
  detail?: string;
  localHead?: string;
  remoteHead?: string;
  error?: string;
}

const CLI_DIST = path.join(PHASER_WX_CLI_DIR, 'dist', 'index.cjs');

function run(cmd: string, cwd?: string, timeout = 30000): string {
  return execSync(cmd, {
    cwd,
    timeout,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: { ...process.env },
  }).trim();
}

/**
 * Read the remote HEAD commit hash for the default branch.
 * Returns null if the network/git call fails (offline, DNS, etc.).
 */
function getRemoteHead(repoDir: string): string | null {
  try {
    // `ls-remote` honours git's own proxy/https config and works for shallow clones.
    const out = run('git ls-remote origin HEAD', repoDir, 15000);
    // Format: "<sha>\tHEAD"
    const firstLine = out.split('\n')[0] || '';
    const sha = firstLine.split(/\s+/)[0];
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function getLocalHead(repoDir: string): string | null {
  try {
    const sha = run('git rev-parse HEAD', repoDir, 5000);
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Is the working tree dirty (uncommitted / untracked changes)?
 * If the user somehow modified the toolchain checkout, we must not clobber it.
 */
function isWorkingTreeDirty(repoDir: string): boolean {
  try {
    const out = run('git status --porcelain', repoDir, 5000);
    return out.length > 0;
  } catch {
    // If `git status` itself fails, treat as dirty to stay safe.
    return true;
  }
}

function detectDefaultBranch(repoDir: string): string {
  // Try the symbolic ref from origin first (most reliable).
  try {
    const out = run('git symbolic-ref --short refs/remotes/origin/HEAD', repoDir, 5000);
    // "origin/main" → "main"
    const branch = out.replace(/^origin\//, '').trim();
    if (branch) return branch;
  } catch {
    // Fall through to heuristics
  }
  // Fallback: try current branch
  try {
    const cur = run('git rev-parse --abbrev-ref HEAD', repoDir, 5000);
    if (cur && cur !== 'HEAD') return cur;
  } catch {
    // Fall through
  }
  return 'main';
}

/**
 * Fetch the latest commits and fast-forward the local checkout.
 * Works for both shallow (depth=1) and full clones — for shallow clones we
 * fetch with --depth 1 and reset hard to the remote head.
 */
function fastForwardToRemote(repoDir: string, remoteSha: string): void {
  const branch = detectDefaultBranch(repoDir);

  // Fetch the target branch with shallow depth (safe for both shallow & full clones).
  run(`git fetch --depth 1 origin ${branch}`, repoDir, 60000);

  // Hard-reset onto the fetched commit. We use FETCH_HEAD rather than remoteSha
  // to guarantee the ref is locally known (especially for shallow fetches).
  run('git reset --hard FETCH_HEAD', repoDir, 15000);

  // Sanity-check we ended up where we expected.
  const newLocal = getLocalHead(repoDir);
  if (newLocal !== remoteSha) {
    // Not fatal — the default branch may have moved again between ls-remote and
    // fetch. Either way we're on a newer commit, so continue.
    console.warn(
      '[phaser-wx-update] post-reset HEAD (%s) != remoteSha (%s) — continuing',
      newLocal?.slice(0, 7),
      remoteSha.slice(0, 7),
    );
  }
}

/**
 * Check GitHub for updates to the phaser-wx toolchain and, if any are
 * available, pull + rebuild. On any failure the local checkout is rolled
 * back so the app continues to use the previously-working version.
 *
 * This function is designed to be called at app startup (non-blocking).
 * It will never throw; errors are reported through the progress callback.
 *
 * @returns the final status of the update attempt
 */
export async function checkAndUpdatePhaserWx(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<UpdateStatus> {
  const repoDir = PHASER_WX_REPO_DIR;
  const emit = (p: UpdateProgress) => {
    try { onProgress?.(p); } catch { /* renderer may be gone */ }
  };

  // 1. Must have a local clone. First-time setup is handled by installPhaserWx.
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    emit({ status: 'skipped-no-repo', detail: 'No local toolchain checkout' });
    return 'skipped-no-repo';
  }

  // 2. Must have a local HEAD we can compare against.
  const localHead = getLocalHead(repoDir);
  if (!localHead) {
    emit({ status: 'skipped-no-git', detail: 'Unable to read local HEAD' });
    return 'skipped-no-git';
  }

  // 3. Ask GitHub for the remote HEAD. Network failure → silently skip.
  emit({ status: 'updating', detail: 'Checking GitHub for updates...', localHead });
  const remoteHead = getRemoteHead(repoDir);
  if (!remoteHead) {
    emit({
      status: 'skipped-no-network',
      detail: 'Unable to reach GitHub (offline?) — using cached toolchain',
      localHead,
    });
    return 'skipped-no-network';
  }

  // 4. Already up-to-date.
  if (remoteHead === localHead) {
    emit({ status: 'up-to-date', detail: 'phaser-wx toolchain is up-to-date', localHead, remoteHead });
    return 'up-to-date';
  }

  // 5. Refuse to touch a dirty working tree (user edits must not be destroyed).
  if (isWorkingTreeDirty(repoDir)) {
    emit({
      status: 'skipped-dirty',
      detail: 'Toolchain working tree has local changes — skipping update',
      localHead,
      remoteHead,
    });
    return 'skipped-dirty';
  }

  // 6. Remember the current HEAD for rollback.
  const rollbackSha = localHead;
  const cliDistExisted = fs.existsSync(CLI_DIST);

  emit({
    status: 'updating',
    detail: `Update available (${localHead.slice(0, 7)} → ${remoteHead.slice(0, 7)}), pulling...`,
    localHead,
    remoteHead,
  });

  try {
    // 7. pnpm is a build-time dependency — make sure it's still available.
    ensurePnpm();

    // 8. Fetch + reset.
    fastForwardToRemote(repoDir, remoteHead);

    // 9. Rebuild + re-link the CLI.
    buildAndLinkPhaserWx(repoDir, (detail) => {
      emit({ status: 'updating', detail, localHead, remoteHead });
    });

    // 10. Confirm the CLI dist is still there (sanity check).
    if (!fs.existsSync(CLI_DIST)) {
      throw new Error('phaser-wx CLI build output missing after update');
    }

    emit({
      status: 'updated',
      detail: `phaser-wx updated to ${remoteHead.slice(0, 7)}`,
      localHead: remoteHead,
      remoteHead,
    });
    return 'updated';
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.warn('[phaser-wx-update] Update failed:', errorMsg);

    // Attempt rollback — return the repo to its previous commit and rebuild.
    try {
      run(`git reset --hard ${rollbackSha}`, repoDir, 15000);

      // If the rebuild completed enough to break the CLI dist, try to restore it
      // by rebuilding the original commit. Only attempt this if the CLI was
      // present before — otherwise there's nothing to restore to.
      if (cliDistExisted && !fs.existsSync(CLI_DIST)) {
        try {
          buildAndLinkPhaserWx(repoDir);
        } catch (rebuildErr: any) {
          console.warn(
            '[phaser-wx-update] Rollback rebuild also failed:',
            rebuildErr?.message || String(rebuildErr),
          );
        }
      }

      emit({
        status: 'failed-rollback',
        detail: 'Update failed — rolled back to previous version',
        localHead: rollbackSha,
        remoteHead,
        error: errorMsg,
      });
      return 'failed-rollback';
    } catch (rollbackErr: any) {
      // Rollback itself failed. The previous CLI dist may still be on disk
      // and functional, so report but don't crash.
      emit({
        status: 'failed',
        detail: 'Update failed and rollback errored — continuing with whatever is on disk',
        localHead: rollbackSha,
        remoteHead,
        error: `${errorMsg} | rollback: ${rollbackErr?.message || String(rollbackErr)}`,
      });
      return 'failed';
    }
  }
}

/** Return true when the status represents a successful update that changed disk state. */
export function wasUpdated(status: UpdateStatus): boolean {
  return status === 'updated';
}
