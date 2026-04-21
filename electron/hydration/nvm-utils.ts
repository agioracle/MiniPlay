import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Resolve the NVM_DIR path.
 * Checks NVM_DIR env var first, then falls back to ~/.nvm.
 * @returns absolute path to nvm directory, or null if not found
 */
function resolveNvmDir(): string | null {
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
  try {
    if (fs.existsSync(nvmDir) && fs.statSync(nvmDir).isDirectory()) {
      return nvmDir;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Dynamically resolve the bin directory of nvm's current active Node.js version.
 *
 * Strategy:
 *   1. Check NVM_DIR env var or ~/.nvm
 *   2. Read alias/default to get the default version alias
 *   3. Scan versions/node/ and pick the highest version
 *
 * @returns absolute path to the bin directory, or null if not found
 */
export function resolveNvmBinDir(): string | null {
  const nvmDir = resolveNvmDir();
  if (!nvmDir) {
    console.log('[PATH] nvm directory not found');
    return null;
  }

  const versionsDir = path.join(nvmDir, 'versions', 'node');

  // Strategy 1: Read alias/default to get the default version
  try {
    const aliasDefault = path.join(nvmDir, 'alias', 'default');
    if (fs.existsSync(aliasDefault)) {
      const alias = fs.readFileSync(aliasDefault, 'utf-8').trim();
      // alias could be like "18", "18.17", "18.17.0", "lts/*", "default", etc.
      // Try to resolve a version prefix match
      if (alias && !alias.includes('/') && !alias.includes('*')) {
        const prefix = alias.startsWith('v') ? alias : `v${alias}`;
        if (fs.existsSync(versionsDir)) {
          const versions = fs.readdirSync(versionsDir)
            .filter(v => v.startsWith(prefix))
            .sort(compareVersions);
          if (versions.length > 0) {
            const binDir = path.join(versionsDir, versions[versions.length - 1], 'bin');
            if (fs.existsSync(binDir)) {
              console.log('[PATH] Resolved nvm bin dir via alias/default:', binDir);
              return binDir;
            }
          }
        }
      }
    }
  } catch {
    // ignore, fall through to next strategy
  }

  // Strategy 2: Scan versions/node/ and pick the highest version
  try {
    if (fs.existsSync(versionsDir)) {
      const versions = fs.readdirSync(versionsDir)
        .filter(v => v.startsWith('v'))
        .sort(compareVersions);
      if (versions.length > 0) {
        const binDir = path.join(versionsDir, versions[versions.length - 1], 'bin');
        if (fs.existsSync(binDir)) {
          console.log('[PATH] Resolved nvm bin dir via highest version scan:', binDir);
          return binDir;
        }
      }
    }
  } catch {
    // ignore
  }

  console.log('[PATH] Could not resolve nvm bin directory');
  return null;
}

/**
 * Find a specific executable in nvm's global bin directory.
 *
 * @param name - executable name (e.g. 'claude', 'codex', 'node')
 * @returns absolute path to the executable, or null if not found
 */
export function findInNvmBin(name: string): string | null {
  const binDir = resolveNvmBinDir();
  if (!binDir) return null;

  const execPath = path.join(binDir, name);
  try {
    if (fs.existsSync(execPath)) {
      // Verify it's executable (not just a directory)
      const stat = fs.statSync(execPath);
      if (stat.isFile()) {
        console.log(`[PATH] Found '${name}' in nvm bin: ${execPath}`);
        return execPath;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Strip ANSI escape characters from a string.
 * Borrowed from fix-path/strip-ansi concept — prevents nvm/oh-my-zsh
 * color codes from polluting PATH strings.
 *
 * @param str - string that may contain ANSI escape sequences
 * @returns cleaned plain text string
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Compare two semver-like version strings for sorting.
 * e.g. "v18.17.0" vs "v20.1.0"
 */
function compareVersions(a: string, b: string): number {
  const pa = a.replace('v', '').split('.').map(Number);
  const pb = b.replace('v', '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}
