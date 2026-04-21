import { execSync } from 'child_process';
import { findInNvmBin } from './nvm-utils';

export interface DetectResult {
  found: boolean;
  version: string | null;
  path: string | null;
}

/**
 * Detect if Node.js >= 18 is available on PATH.
 * Falls back to scanning nvm's bin directory when `which node` fails.
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
    // Supplementary: try to find node in nvm's bin directory
    const nvmNodePath = findInNvmBin('node');
    if (nvmNodePath) {
      try {
        const version = execSync(`"${nvmNodePath}" -v`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim();
        const major = parseInt(version.replace('v', '').split('.')[0], 10);
        if (major >= 18) {
          console.log(`[PATH] Detected node via nvm bin scan: ${nvmNodePath}`);
          return { found: true, version, path: nvmNodePath };
        }
      } catch {
        // nvm node binary doesn't work
      }
    }
    return { found: false, version: null, path: null };
  }
}
