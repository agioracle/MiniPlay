import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TOOLCHAIN_DIR } from '../storage/paths';
import type { DetectResult } from './detect-node';

export interface PhaserWxDetectResult extends DetectResult {
  /**
   * Whether the toolchain directory is fully ready:
   *   - phaserjs-webgl-transform repo exists under TOOLCHAIN_DIR
   *   - CLI dist is built (packages/cli/dist/index.cjs)
   *   - Template directories exist (example-portrait / example-landscape)
   */
  toolchainReady: boolean;
}

/** Path constants derived from TOOLCHAIN_DIR */
const REPO_DIR = path.join(TOOLCHAIN_DIR, 'phaserjs-webgl-transform');
const CLI_DIST = path.join(REPO_DIR, 'packages', 'cli', 'dist', 'index.cjs');
const TEMPLATE_PORTRAIT = path.join(REPO_DIR, 'example-portrait');
const TEMPLATE_LANDSCAPE = path.join(REPO_DIR, 'example-landscape');

/**
 * Check whether the toolchain directory is complete:
 *   - CLI dist exists
 *   - At least one template directory exists
 */
function isToolchainComplete(): boolean {
  return (
    fs.existsSync(CLI_DIST) &&
    (fs.existsSync(TEMPLATE_PORTRAIT) || fs.existsSync(TEMPLATE_LANDSCAPE))
  );
}

/**
 * Try to get the version from the toolchain CLI dist.
 * Returns the version string, or null if the CLI is missing / broken.
 */
function getToolchainCliVersion(): string | null {
  if (!fs.existsSync(CLI_DIST)) return null;
  try {
    return execSync(`node "${CLI_DIST}" --version`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect if phaser-wx CLI is available.
 *
 * **Priority: toolchain directory first.**
 *
 * The returned `path` always points to the toolchain CLI dist so that
 * all downstream consumers (scaffold, env-cache, …) use the managed copy
 * rather than an arbitrary global install that may lack template directories.
 *
 * `toolchainReady` indicates whether the toolchain directory is fully
 * operational (CLI built + templates present). When `false`, hydration
 * should trigger an install/repair regardless of whether a system-wide
 * `phaser-wx` binary exists.
 */
export function detectPhaserWx(): PhaserWxDetectResult {
  const toolchainComplete = isToolchainComplete();

  // ---- 1. Toolchain directory takes precedence ----
  if (toolchainComplete) {
    const version = getToolchainCliVersion();
    if (version) {
      return { found: true, version, path: CLI_DIST, toolchainReady: true };
    }
    // CLI exists but broken — fall through, mark not ready
  }

  // ---- 2. Fallback: check system PATH (for display only) ----
  // Even if a system-wide phaser-wx exists, `toolchainReady` stays false
  // so that hydration will still install into the toolchain directory.
  try {
    const version = execSync('phaser-wx --version', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    }).trim();
    return { found: true, version, path: CLI_DIST, toolchainReady: false };
  } catch {
    // Not on PATH either
  }

  return { found: false, version: null, path: null, toolchainReady: false };
}
