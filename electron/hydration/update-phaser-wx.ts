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
  | 'skipped-no-tags'
  | 'skipped-dirty'
  | 'up-to-date'
  | 'updating'
  | 'updated'
  | 'failed-rollback'
  | 'failed';

export interface UpdateProgress {
  status: UpdateStatus;
  detail?: string;
  /** Currently-checked-out release tag, e.g. "v1.0.0". `null` when HEAD isn't on a tag. */
  localTag?: string | null;
  /** Highest release tag found on the remote. */
  remoteTag?: string | null;
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

/** Parse a SemVer-ish tag like `v1.2.3`, `1.2.3`, `v1.2.3-beta.1`. Returns null if unparseable. */
interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string | null; // pre-release suffix (without leading `-`), or null for a stable release
  raw: string;
}

function parseVersion(tag: string): ParsedVersion | null {
  // Strip a leading `v` / `V`.
  const s = tag.replace(/^[vV]/, '');
  // Match `MAJOR.MINOR.PATCH` with an optional `-prerelease` / `+build` suffix.
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(s);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ?? null,
    raw: tag,
  };
}

/**
 * SemVer comparison: positive if `a > b`, negative if `a < b`, 0 if equal.
 * Stable releases (no pre-release) rank higher than any pre-release of the
 * same MAJOR.MINOR.PATCH (per SemVer 2.0.0 §11).
 */
function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // Same numeric version → stable > any pre-release.
  if (a.pre === null && b.pre === null) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  // Both have pre-release identifiers — compare dot-separated ids per SemVer.
  const aIds = a.pre.split('.');
  const bIds = b.pre.split('.');
  const len = Math.max(aIds.length, bIds.length);
  for (let i = 0; i < len; i++) {
    const av = aIds[i];
    const bv = bIds[i];
    if (av === undefined) return -1; // shorter identifier list ranks lower
    if (bv === undefined) return 1;
    const aNum = /^\d+$/.test(av);
    const bNum = /^\d+$/.test(bv);
    if (aNum && bNum) {
      const d = Number(av) - Number(bv);
      if (d !== 0) return d;
    } else if (aNum) {
      return -1; // numeric < alphanumeric
    } else if (bNum) {
      return 1;
    } else {
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
  }
  return 0;
}

/**
 * Read the list of release tags from the remote.
 * Returns null when the network call fails (offline, DNS, etc.) so callers
 * can distinguish "offline" from "no tags published yet".
 */
function listRemoteTags(repoDir: string): Array<{ tag: string; sha: string }> | null {
  try {
    // `--refs` strips the `^{}` peeled lines, so each line is "<sha>\trefs/tags/<tag>"
    const out = run('git ls-remote --tags --refs origin', repoDir, 15000);
    if (!out) return [];
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, ref] = line.split(/\s+/);
        const tag = ref?.replace(/^refs\/tags\//, '') ?? '';
        return { tag, sha };
      })
      .filter((e) => /^[0-9a-f]{40}$/i.test(e.sha) && e.tag.length > 0);
  } catch {
    return null;
  }
}

/**
 * Determine which remote tag (if any) is the current "latest" release.
 * Selects the highest parseable semver among the remote tags and ignores any
 * tag whose format we don't understand.
 */
function pickLatestTag(tags: Array<{ tag: string; sha: string }>): { tag: string; sha: string; parsed: ParsedVersion } | null {
  let best: { tag: string; sha: string; parsed: ParsedVersion } | null = null;
  for (const entry of tags) {
    const parsed = parseVersion(entry.tag);
    if (!parsed) continue;
    if (!best || compareVersions(parsed, best.parsed) > 0) {
      best = { tag: entry.tag, sha: entry.sha, parsed };
    }
  }
  return best;
}

/**
 * Find the tag currently pointed at by HEAD, if any.
 * Uses `git describe --tags --exact-match HEAD` so we only consider tags, not
 * annotated branch heads. Returns null when HEAD isn't on a tag.
 */
function getLocalTag(repoDir: string): string | null {
  try {
    const tag = run('git describe --tags --exact-match HEAD', repoDir, 5000);
    return tag || null;
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

function isWorkingTreeDirty(repoDir: string): boolean {
  try {
    const out = run('git status --porcelain', repoDir, 5000);
    return out.length > 0;
  } catch {
    return true;
  }
}

/**
 * Fetch the specific tag from origin (shallow-clone compatible) and check it
 * out as a detached HEAD. Using `reset --hard FETCH_HEAD` keeps behaviour
 * consistent for both shallow and full clones.
 */
function checkoutRemoteTag(repoDir: string, tag: string): void {
  // Fetch only the tag ref we care about, with depth 1 for efficiency.
  run(`git fetch --depth 1 origin "refs/tags/${tag}:refs/tags/${tag}"`, repoDir, 60000);
  // Detach HEAD onto the fetched tag. `-c advice.detachedHead=false` keeps
  // stderr quiet in the non-TTY case (execSync captures it anyway, but avoids
  // noisy warnings reaching the user if we ever surface raw output).
  run(`git -c advice.detachedHead=false checkout --force "refs/tags/${tag}"`, repoDir, 15000);
}

/**
 * Check the phaser-wx GitHub repo for a newer release tag and, if one exists,
 * check it out and rebuild the toolchain. On any failure the local checkout
 * is rolled back to the previous commit so the app keeps using the
 * previously-working version.
 *
 * Update semantics (tag-based):
 *   - Only tags that parse as SemVer are considered.
 *   - The highest remote tag wins. Stable releases rank above pre-releases of
 *     the same MAJOR.MINOR.PATCH.
 *   - The app updates when the highest remote tag is strictly greater than
 *     the locally-checked-out tag (or when the local checkout isn't on any
 *     tag at all — e.g. a user still on a `main` branch from an older
 *     install).
 *
 * This function never throws; errors are reported through the progress
 * callback and the return value.
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

  const localTag = getLocalTag(repoDir);
  const localParsed = localTag ? parseVersion(localTag) : null;

  // 3. Ask GitHub for the tag list. Network failure → silently skip.
  emit({
    status: 'updating',
    detail: 'Checking GitHub for new phaser-wx releases...',
    localTag,
  });
  const remoteTags = listRemoteTags(repoDir);
  if (remoteTags === null) {
    emit({
      status: 'skipped-no-network',
      detail: 'Unable to reach GitHub (offline?) — using cached toolchain',
      localTag,
    });
    return 'skipped-no-network';
  }

  // 4. No release tags on the remote at all → nothing to pull.
  const latest = pickLatestTag(remoteTags);
  if (!latest) {
    emit({
      status: 'skipped-no-tags',
      detail: 'Upstream has no semver-tagged releases — using cached toolchain',
      localTag,
    });
    return 'skipped-no-tags';
  }

  // 5. Decide whether we need to move. We need to upgrade if:
  //    - local isn't on any parseable tag (older installs on `main`), OR
  //    - remote tag is strictly greater than local tag.
  const shouldUpdate =
    !localParsed || compareVersions(latest.parsed, localParsed) > 0;

  if (!shouldUpdate) {
    emit({
      status: 'up-to-date',
      detail: `phaser-wx is up-to-date (${localTag})`,
      localTag,
      remoteTag: latest.tag,
    });
    return 'up-to-date';
  }

  // 6. Refuse to touch a dirty working tree (user edits must not be destroyed).
  if (isWorkingTreeDirty(repoDir)) {
    emit({
      status: 'skipped-dirty',
      detail: 'Toolchain working tree has local changes — skipping update',
      localTag,
      remoteTag: latest.tag,
    });
    return 'skipped-dirty';
  }

  // 7. Remember the current commit for rollback.
  const rollbackSha = localHead;
  const cliDistExisted = fs.existsSync(CLI_DIST);

  emit({
    status: 'updating',
    detail: localParsed
      ? `Update available (${localTag} → ${latest.tag}), pulling release...`
      : `Switching to latest release ${latest.tag}...`,
    localTag,
    remoteTag: latest.tag,
  });

  try {
    // 8. pnpm is a build-time dependency — make sure it's still available.
    ensurePnpm();

    // 9. Fetch the tag and check it out (detached HEAD is fine — the
    //    toolchain is not a user-edited workspace).
    checkoutRemoteTag(repoDir, latest.tag);

    // 10. Rebuild + re-link the CLI.
    buildAndLinkPhaserWx(repoDir, (detail) => {
      emit({ status: 'updating', detail, localTag, remoteTag: latest.tag });
    });

    // 11. Confirm the CLI dist is still there.
    if (!fs.existsSync(CLI_DIST)) {
      throw new Error('phaser-wx CLI build output missing after update');
    }

    emit({
      status: 'updated',
      detail: `phaser-wx updated to ${latest.tag}`,
      localTag: latest.tag,
      remoteTag: latest.tag,
    });
    return 'updated';
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.warn('[phaser-wx-update] Update failed:', errorMsg);

    // Attempt rollback — return the repo to its previous commit and rebuild.
    try {
      run(`git reset --hard ${rollbackSha}`, repoDir, 15000);

      // If the rebuild broke the CLI dist, try to restore it by rebuilding
      // the original commit. Only attempt this if the CLI was present
      // before — otherwise there's nothing to restore to.
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
        localTag,
        remoteTag: latest.tag,
        error: errorMsg,
      });
      return 'failed-rollback';
    } catch (rollbackErr: any) {
      // Rollback itself failed. The previous CLI dist may still be on disk
      // and functional, so report but don't crash.
      emit({
        status: 'failed',
        detail: 'Update failed and rollback errored — continuing with whatever is on disk',
        localTag,
        remoteTag: latest.tag,
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
