import { BrowserWindow } from 'electron';
import { detectNode } from './detect-node';
import { detectAllCoders } from './detect-coder';
import { detectPhaserWx } from './detect-phaser-wx';
import { installNode, getManagedNodeBinDir } from './install-node';
import { installPhaserWx } from './install-phaser-wx';
import { readConfig, writeConfig } from '../storage/config';
import { CODER_AGENTS, CODER_AGENT_PRIORITY } from '../coder/agents';
import type { CoderAgentId } from '../coder/agents';
import { ensureMiniPlayHome } from '../storage/paths';

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
  const managedBin = getManagedNodeBinDir();
  if (managedBin && !process.env.PATH?.includes(managedBin)) {
    const sep = process.platform === 'win32' ? ';' : ':';
    process.env.PATH = `${managedBin}${sep}${process.env.PATH}`;
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
  if (phaserWxResult.found) {
    updateStep(1, { status: 'done', detail: `${phaserWxResult.version}` });
  } else {
    updateStep(1, { status: 'installing', detail: 'Setting up phaser-wx toolchain...' });
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
 */
export function initHydrationPath(): void {
  patchPath();
}
