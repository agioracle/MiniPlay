import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TOOLCHAIN_DIR } from '../storage/paths';
import type { DetectResult } from './detect-node';

/**
 * Detect if phaser-wx CLI is available.
 * First checks PATH, then checks the managed toolchain directory.
 */
export function detectPhaserWx(): DetectResult {
  // Check if phaser-wx is on PATH
  try {
    const version = execSync('phaser-wx --version', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    }).trim();
    const phaserWxPath = execSync('which phaser-wx', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'pipe',
    }).trim();
    return { found: true, version, path: phaserWxPath };
  } catch {
    // Fall through
  }

  // Check managed toolchain dir
  const repoDir = path.join(TOOLCHAIN_DIR, 'phaserjs-webgl-transform');
  const cliDist = path.join(repoDir, 'packages', 'cli', 'dist', 'index.cjs');
  if (fs.existsSync(cliDist)) {
    try {
      const version = execSync(`node "${cliDist}" --version`, {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'pipe',
      }).trim();
      return { found: true, version, path: cliDist };
    } catch {
      // Exists but broken
    }
  }

  return { found: false, version: null, path: null };
}
