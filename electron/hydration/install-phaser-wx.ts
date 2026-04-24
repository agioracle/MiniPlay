import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TOOLCHAIN_DIR, ensureDir } from '../storage/paths';
import { getManagedNodeBinDir } from './install-node';

// PRD §7.2 specifies this exact URL
export const PHASER_WX_REPO_URL = 'https://github.com/agioracle/phaserjs-webgl-transform.git';
export const PHASER_WX_REPO_DIR = path.join(TOOLCHAIN_DIR, 'phaserjs-webgl-transform');
export const PHASER_WX_CLI_DIR = path.join(PHASER_WX_REPO_DIR, 'packages', 'cli');

/**
 * Detect if pnpm is available. If not, install it via npm.
 */
export function ensurePnpm(): void {
  try {
    execSync('pnpm --version', { stdio: 'pipe', timeout: 10000 });
  } catch {
    // pnpm not found — install globally via npm
    execSync('npm install -g pnpm', {
      timeout: 60000,
      stdio: 'pipe',
      env: { ...process.env },
    });
    // Verify
    execSync('pnpm --version', { stdio: 'pipe', timeout: 10000 });
  }
}

/**
 * Link the phaser-wx CLI binary into a directory that's already on PATH.
 * Avoids `npm link` which requires write access to /usr/local/lib/node_modules.
 *
 * Strategy:
 * 1. Try managed node bin dir (~/Library/Application Support/MiniPlay/node/bin/)
 * 2. Fallback to ~/.miniplay/bin/
 */
export function linkPhaserWxBin(cliDir: string): void {
  const cliPkg = JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf-8'));
  const binEntries = cliPkg.bin || {};

  // Determine target bin directory
  let binDir = getManagedNodeBinDir();
  if (!binDir) {
    // Fallback: create a bin dir under toolchain
    binDir = path.join(TOOLCHAIN_DIR, 'bin');
  }
  ensureDir(binDir);

  for (const [name, relPath] of Object.entries(binEntries)) {
    const target = path.resolve(cliDir, relPath as string);
    const link = path.join(binDir, name);

    // Remove existing link/file
    try { fs.unlinkSync(link); } catch {}

    // Create symlink
    fs.symlinkSync(target, link);

    // Ensure executable
    try { fs.chmodSync(target, 0o755); } catch {}
  }
}

/**
 * Build (install deps + compile) the already-cloned phaser-wx repo, then link
 * the CLI binary. Shared by `installPhaserWx` (first-time setup) and
 * `checkAndUpdatePhaserWx` (startup update).
 */
export function buildAndLinkPhaserWx(
  repoDir: string,
  onProgress?: (detail: string) => void,
): void {
  // Install dependencies via pnpm
  onProgress?.('Installing dependencies (pnpm install)...');
  execSync('pnpm install --frozen-lockfile', {
    cwd: repoDir,
    timeout: 120000,
    stdio: 'pipe',
    env: { ...process.env },
  });

  // Build all packages
  onProgress?.('Building toolchain (pnpm build)...');
  execSync('pnpm run build', {
    cwd: repoDir,
    timeout: 60000,
    stdio: 'pipe',
    env: { ...process.env },
  });

  // Link CLI binary into managed bin dir (no sudo required)
  onProgress?.('Linking phaser-wx CLI...');
  const cliDir = path.join(repoDir, 'packages', 'cli');
  linkPhaserWxBin(cliDir);
}

/**
 * Clone and build the phaserjs-webgl-transform toolchain.
 * Links phaser-wx CLI into the managed bin dir so it's available on PATH.
 *
 * The project is a pnpm monorepo with 3 packages:
 *   @aspect/adapter, @aspect/rollup-plugin, @aspect/cli
 */
export async function installPhaserWx(onProgress?: (detail: string) => void): Promise<string> {
  ensureDir(TOOLCHAIN_DIR);
  const repoDir = PHASER_WX_REPO_DIR;

  // Step 1: Ensure pnpm is available
  onProgress?.('Checking pnpm...');
  ensurePnpm();

  // Step 2: Clone or pull
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    onProgress?.('Cloning phaserjs-webgl-transform...');
    execSync(`git clone --depth 1 "${PHASER_WX_REPO_URL}" "${repoDir}"`, {
      timeout: 120000,
      stdio: 'pipe',
    });
  } else {
    onProgress?.('Updating phaserjs-webgl-transform...');
    try {
      execSync('git pull --ff-only', {
        cwd: repoDir,
        timeout: 30000,
        stdio: 'pipe',
      });
    } catch {
      // Pull failed (detached HEAD, dirty state, etc.) — not fatal, continue with existing code
    }
  }

  // Steps 3-5: install deps, build, link CLI
  buildAndLinkPhaserWx(repoDir, onProgress);

  // Verify the CLI is accessible
  try {
    const version = execSync('phaser-wx --version', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    }).trim();
    onProgress?.(`phaser-wx ${version} ready`);
  } catch {
    // Verify via direct file existence
    const cliDist = path.join(PHASER_WX_CLI_DIR, 'dist', 'index.cjs');
    if (fs.existsSync(cliDist)) {
      onProgress?.('phaser-wx built (linked)');
    } else {
      throw new Error('phaser-wx CLI build output not found');
    }
  }

  return repoDir;
}
