import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * All MiniPlay data lives under ~/.miniplay/
 */
export const MINIPLAY_HOME = path.join(os.homedir(), '.miniplay');
export const PROJECTS_DIR = path.join(MINIPLAY_HOME, 'projects');
export const CONFIG_PATH = path.join(MINIPLAY_HOME, 'config.json');
export const PROJECTS_INDEX_PATH = path.join(MINIPLAY_HOME, 'projects.json');

/** Application Support dir for managed toolchain binaries */
const APP_SUPPORT =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'MiniPlay')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'MiniPlay');

export const TOOLCHAIN_DIR = path.join(APP_SUPPORT, 'toolchain');
export const MANAGED_NODE_DIR = path.join(APP_SUPPORT, 'node');

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensureMiniPlayHome(): void {
  ensureDir(MINIPLAY_HOME);
  ensureDir(PROJECTS_DIR);
  ensureDir(APP_SUPPORT);
  ensureDir(TOOLCHAIN_DIR);
}
