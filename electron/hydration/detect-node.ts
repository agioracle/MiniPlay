import { execSync } from 'child_process';

export interface DetectResult {
  found: boolean;
  version: string | null;
  path: string | null;
}

/**
 * Detect if Node.js >= 18 is available on PATH
 */
export function detectNode(): DetectResult {
  try {
    const version = execSync('node -v', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
    const major = parseInt(version.replace('v', '').split('.')[0], 10);
    if (major >= 18) {
      const nodePath = execSync('which node', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
      return { found: true, version, path: nodePath };
    }
    return { found: false, version, path: null };
  } catch {
    return { found: false, version: null, path: null };
  }
}
