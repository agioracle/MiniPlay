import { BrowserWindow } from 'electron';
import { detectNode } from './detect-node';
import { detectAllCoders } from './detect-coder';
import { detectPhaserWx } from './detect-phaser-wx';
import { installNode, getManagedNodeBinDir } from './install-node';
import { installPhaserWx } from './install-phaser-wx';
import { readConfig, writeConfig } from '../storage/config';
import { CODER_AGENTS, CODER_AGENT_PRIORITY } from '../coder/agents';
import type { CoderAgentId } from '../coder/agents';
import { ensureMiniPlayHome, TOOLCHAIN_DIR } from '../storage/paths';
import { resolveNvmBinDir, stripAnsi } from './nvm-utils';
import * as path from 'path';
import * as fs from 'fs';

export interface HydrationStep {
  id: string;
  label: string;
  status: 'pending' | 'checking' | 'installing' | 'done' | 'warning' | 'error';
  detail?: string;
  /** Sub-items for the coder agent detection step */
  children?: HydrationStep[];
}

function send(win: BrowserWindow, steps: HydrationStep[]) {
  win.webContents.send('hydration:progress', JSON.parse(JSON.stringify(steps)));
}

/**
 * Prepend managed toolchain binaries to process.env.PATH.
 * Safe to call multiple times — only prepends if not already present.
 */
export function patchPath(): void {
  const sep = process.platform === 'win32' ? ';' : ':';
  const managedBin = getManagedNodeBinDir();
  if (managedBin && !process.env.PATH?.includes(managedBin)) {
    process.env.PATH = `${managedBin}${sep}${process.env.PATH}`;
  }
  // Also add toolchain bin dir (where phaser-wx may be symlinked)
  const toolchainBin = path.join(TOOLCHAIN_DIR, 'bin');
  if (!process.env.PATH?.includes(toolchainBin)) {
    process.env.PATH = `${toolchainBin}${sep}${process.env.PATH}`;
  }
}

/**
 * Determine a POSIX-compatible shell for PATH recovery.
 * If the user's default shell is non-POSIX (Fish, Nushell, etc.),
 * fall back to /bin/zsh or /bin/bash. (Borrowed from fix-path.)
 */
function resolveShell(): string {
  const shell = process.env.SHELL || '/bin/zsh';
  const basename = path.basename(shell);

  // Non-POSIX shells don't support -ilc flags
  const nonPosixShells = ['fish', 'nu', 'nushell', 'elvish', 'xonsh'];
  if (nonPosixShells.includes(basename)) {
    console.log(`[PATH] Default shell '${basename}' is non-POSIX, falling back`);
    if (fs.existsSync('/bin/zsh')) return '/bin/zsh';
    if (fs.existsSync('/bin/bash')) return '/bin/bash';
  }
  return shell;
}

/**
 * Build env for sub-shell execution.
 * Injects oh-my-zsh anti-blocking vars (borrowed from fix-path)
 * and ensures NVM_DIR is set.
 */
function buildShellEnv(): Record<string, string | undefined> {
  const home = process.env.HOME || require('os').homedir();
  return {
    ...process.env,
    HOME: home,
    // Ensure NVM_DIR is set so explicit source works
    NVM_DIR: process.env.NVM_DIR || path.join(home, '.nvm'),
    // oh-my-zsh anti-blocking (borrowed from fix-path)
    DISABLE_AUTO_UPDATE: 'true',
    ZSH_TMUX_AUTOSTART: 'false',
  };
}

/**
 * Recover the user's full shell PATH.
 *
 * When a packaged Electron app is launched from Finder/Dock on macOS,
 * process.env.PATH only contains /usr/bin:/bin:/usr/sbin:/sbin.
 * This function runs the user's login shell to get the full PATH
 * (including /usr/local/bin, homebrew, nvm, npm global, etc.).
 *
 * Multi-level recovery strategy:
 *   1. Interactive shell + explicit `source nvm` + `command env` to get PATH
 *   2. Fallback: login shell `-lc` (simpler, no interactive)
 *   3. Ultimate fallback: manually assemble common paths + dynamic nvm bin dir
 */
function recoverShellPath(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return;

  const shell = resolveShell();
  const shellEnv = buildShellEnv();
  const { execSync: exec } = require('child_process');

  // ---- Primary: interactive shell + explicit source nvm + command env ----
  try {
    const marker = `__MINIPLAY_PATH_${Date.now()}__`;
    // Use `command env` (POSIX, alias-safe) instead of `echo $PATH` (borrowed from fix-path).
    // Also explicitly source nvm init script to handle lazy-loading / non-TTY skip.
    const cmd = [
      `source "$NVM_DIR/nvm.sh" 2>/dev/null;`,
      `echo ${marker};`,
      `command env;`,
      `echo ${marker}`,
    ].join(' ');

    const raw: string = exec(`${shell} -ilc '${cmd}'`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: 'pipe',
      env: shellEnv,
    });

    // Strip ANSI escape chars that nvm/oh-my-zsh may inject (borrowed from fix-path)
    const cleaned = stripAnsi(raw);

    // Extract content between markers
    const lines = cleaned.split('\n');
    const startIdx = lines.findIndex((l: string) => l.trim() === marker);
    const endIdx = lines.findIndex((l: string, i: number) => i > startIdx && l.trim() === marker);
    if (startIdx >= 0 && endIdx > startIdx) {
      // Find PATH= line in the `command env` output
      const envBlock = lines.slice(startIdx + 1, endIdx);
      const pathLine = envBlock.find((l: string) => l.startsWith('PATH='));
      if (pathLine) {
        const fullPath = pathLine.substring('PATH='.length).trim();
        if (fullPath && fullPath.includes('/')) {
          process.env.PATH = fullPath;
          console.log('[PATH] Recovered shell PATH via interactive shell + source nvm (%d chars)', fullPath.length);
          return;
        }
      }
    }
    console.log('[PATH] Primary recovery: markers/PATH not found in output, trying fallback');
  } catch (err: any) {
    console.warn('[PATH] Primary recovery failed:', err.message);
  }

  // ---- Fallback: login shell -lc ----
  try {
    const raw: string = exec(`${shell} -lc 'command env'`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
      env: shellEnv,
    });

    const cleaned = stripAnsi(raw);
    const pathLine = cleaned.split('\n').find((l: string) => l.startsWith('PATH='));
    if (pathLine) {
      const simplePath = pathLine.substring('PATH='.length).trim();
      if (simplePath && simplePath.includes('/') && simplePath.length > (process.env.PATH?.length || 0)) {
        process.env.PATH = simplePath;
        console.log('[PATH] Recovered shell PATH via login shell fallback (%d chars)', simplePath.length);
        return;
      }
    }
    console.log('[PATH] Fallback recovery: PATH not improved, trying ultimate fallback');
  } catch (err: any) {
    console.warn('[PATH] Fallback recovery failed:', err.message);
  }

  // ---- Ultimate fallback: manually assemble common paths ----
  console.log('[PATH] Using ultimate fallback: manually assembling common paths');
  const sep = ':';
  const home = process.env.HOME || require('os').homedir();
  const commonPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    `${home}/.npm-global/bin`,
    `${home}/.local/bin`,
  ];

  // Dynamic nvm bin directory (replaces the old invalid `~/.nvm/versions/node` hardcode)
  const nvmBin = resolveNvmBinDir();
  if (nvmBin) {
    commonPaths.push(nvmBin);
  }

  const currentPath = process.env.PATH || '';
  const missing = commonPaths.filter(p => !currentPath.includes(p));
  if (missing.length > 0) {
    process.env.PATH = `${missing.join(sep)}${sep}${currentPath}`;
    console.log('[PATH] Patched PATH with %d missing common paths', missing.length);
  }
}

/**
 * Run full hydration check & install sequence.
 *
 * Step order:
 *   1. Node.js      — auto-detect & auto-install (blocking)
 *   2. phaser-wx    — auto-detect & auto-install (blocking)
 *   3. Coder Agents — detect ALL supported agents (non-blocking)
 *       - Shows detection result for each agent
 *       - If ≥1 installed → auto-select by priority (claude-code > codex > gemini-cli > opencode)
 *       - If none installed → warning with install instructions
 */
export async function runHydration(win: BrowserWindow): Promise<boolean> {
  ensureMiniPlayHome();

  const steps: HydrationStep[] = [
    { id: 'node', label: 'Node.js (>= 18)', status: 'pending' },
    { id: 'phaser-wx', label: 'phaser-wx Toolchain', status: 'pending' },
    { id: 'coder', label: 'Coder Agents', status: 'pending', children: [] },
  ];

  const updateStep = (index: number, partial: Partial<HydrationStep>) => {
    Object.assign(steps[index], partial);
    send(win, steps);
  };

  // ========== Step 1: Node.js (auto-install, blocking) ==========
  updateStep(0, { status: 'checking' });

  let nodeResult = detectNode();
  if (nodeResult.found) {
    updateStep(0, { status: 'done', detail: `${nodeResult.version} detected` });
  } else {
    updateStep(0, { status: 'installing', detail: 'Downloading Node.js...' });
    try {
      await installNode((detail) => updateStep(0, { detail }));
      patchPath();
      nodeResult = detectNode();
      updateStep(0, {
        status: 'done',
        detail: nodeResult.found ? `${nodeResult.version} installed` : 'Installed to app support directory',
      });
    } catch (err: any) {
      updateStep(0, { status: 'error', detail: err.message || String(err) });
      return false;
    }
  }
  patchPath();

  // ========== Step 2: phaser-wx Toolchain (auto-install, blocking) ==========
  updateStep(1, { status: 'checking' });

  const phaserWxResult = detectPhaserWx();
  if (phaserWxResult.toolchainReady) {
    // Toolchain directory is complete — CLI built + templates present
    updateStep(1, { status: 'done', detail: `${phaserWxResult.version}` });
  } else {
    // Toolchain directory is NOT ready.
    // Even if a system-wide phaser-wx exists (found=true), we still need
    // to set up the managed toolchain directory so that templates are available.
    const hint = phaserWxResult.found
      ? 'System phaser-wx detected, setting up managed toolchain...'
      : 'Setting up phaser-wx toolchain...';
    updateStep(1, { status: 'installing', detail: hint });
    try {
      await installPhaserWx((detail) => updateStep(1, { detail }));
      updateStep(1, { status: 'done', detail: 'Built & linked' });
    } catch (err: any) {
      updateStep(1, { status: 'error', detail: err.message || String(err) });
      return false;
    }
  }

  // ========== Step 3: Coder Agents (detect all, non-blocking) ==========
  updateStep(2, { status: 'checking', detail: 'Scanning installed coding agents...' });

  // Detect all agents, showing each as a child step
  const allResults = detectAllCoders();
  const children: HydrationStep[] = [];

  for (const r of allResults) {
    children.push({
      id: `coder-${r.agentId}`,
      label: r.agentName,
      status: r.found ? 'done' : 'warning',
      detail: r.found
        ? `${r.version}`
        : `Not found`,
    });
  }

  // Determine which agents are installed, pick the best one by priority
  const installedAgents = allResults.filter(r => r.found);

  if (installedAgents.length > 0) {
    // Auto-select by priority order
    let selectedId: CoderAgentId = installedAgents[0].agentId;
    for (const priorityId of CODER_AGENT_PRIORITY) {
      if (installedAgents.some(r => r.agentId === priorityId)) {
        selectedId = priorityId;
        break;
      }
    }

    const selectedAgent = CODER_AGENTS[selectedId];
    writeConfig({ coderAgent: selectedId });

    // Mark the selected one in children
    for (const child of children) {
      if (child.id === `coder-${selectedId}`) {
        child.detail = `${allResults.find(r => r.agentId === selectedId)?.version} (selected)`;
      }
    }

    updateStep(2, {
      status: 'done',
      detail: `Using ${selectedAgent.name}`,
      children,
    });
  } else {
    // None installed — warning (non-blocking, user can install later)
    const installHints = CODER_AGENT_PRIORITY
      .map(id => `  ${CODER_AGENTS[id].name}: ${CODER_AGENTS[id].installInstructions}`)
      .join('\n');

    updateStep(2, {
      status: 'warning',
      detail: `No coding agent found. Please install at least one:\n${installHints}`,
      children,
    });
  }

  // Mark hydration complete (coder warning is non-blocking)
  writeConfig({ hydrationComplete: true });
  return true;
}

/**
 * Quick check — is hydration already complete?
 * 
 * Validates that:
 * 1. Config flag is set to true
 * 2. Node.js is actually installed and functional
 * 3. Invalidates the flag if validation fails
 */
export function isHydrationComplete(): boolean {
  const config = readConfig();
  if (!config.hydrationComplete) return false;

  // Always validate Node works, regardless of managed/system
  const node = detectNode();
  if (!node.found) {
    writeConfig({ hydrationComplete: false });
    return false;
  }

  return true;
}

/**
 * Called at app startup to patch PATH.
 * First recovers the user's full shell PATH (important for packaged apps),
 * then prepends managed toolchain binaries.
 */
export function initHydrationPath(): void {
  recoverShellPath();
  patchPath();
}
