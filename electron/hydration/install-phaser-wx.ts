import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TOOLCHAIN_DIR, ensureDir } from '../storage/paths';

// PRD §7.2 specifies this exact URL
const REPO_URL = 'https://github.com/agioracle/phaserjs-webgl-transform.git';

/**
 * Detect if pnpm is available. If not, install it via npm.
 */
function ensurePnpm(): void {
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
 * Clone and build the phaserjs-webgl-transform toolchain.
 * Links phaser-wx CLI globally so it's available on PATH.
 *
 * The project is a pnpm monorepo with 3 packages:
 *   @aspect/adapter, @aspect/rollup-plugin, @aspect/cli
 */
export async function installPhaserWx(onProgress?: (detail: string) => void): Promise<string> {
  ensureDir(TOOLCHAIN_DIR);
  const repoDir = path.join(TOOLCHAIN_DIR, 'phaserjs-webgl-transform');

  // Step 1: Ensure pnpm is available
  onProgress?.('Checking pnpm...');
  ensurePnpm();

  // Step 2: Clone or pull
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    onProgress?.('Cloning phaserjs-webgl-transform...');
    execSync(`git clone --depth 1 "${REPO_URL}" "${repoDir}"`, {
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

  // Step 3: Install dependencies via pnpm
  onProgress?.('Installing dependencies (pnpm install)...');
  execSync('pnpm install --frozen-lockfile', {
    cwd: repoDir,
    timeout: 120000,
    stdio: 'pipe',
    env: { ...process.env },
  });

  // Step 4: Build all packages
  onProgress?.('Building toolchain (pnpm build)...');
  execSync('pnpm run build', {
    cwd: repoDir,
    timeout: 60000,
    stdio: 'pipe',
    env: { ...process.env },
  });

  // Step 5: Link CLI globally so `phaser-wx` is on PATH
  onProgress?.('Linking phaser-wx CLI...');
  const cliDir = path.join(repoDir, 'packages', 'cli');

  // Use npm link (works regardless of whether user's global is npm or pnpm)
  execSync('npm link', {
    cwd: cliDir,
    timeout: 30000,
    stdio: 'pipe',
    env: { ...process.env },
  });

  // Verify the CLI is accessible
  try {
    const version = execSync('phaser-wx --version', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    }).trim();
    onProgress?.(`phaser-wx ${version} ready`);
  } catch {
    // Link might not be on PATH yet — verify via direct node execution
    const cliDist = path.join(cliDir, 'dist', 'index.cjs');
    if (fs.existsSync(cliDist)) {
      onProgress?.('phaser-wx built (linked)');
    } else {
      throw new Error('phaser-wx CLI build output not found');
    }
  }

  return repoDir;
}
