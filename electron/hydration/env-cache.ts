import { detectNode, type DetectResult } from './detect-node';
import { detectPhaserWx } from './detect-phaser-wx';
import { detectAllCoders, type CoderDetectResult } from './detect-coder';
import type { CoderAgentId } from '../coder/agents';
import { readConfig } from '../storage/config';

export interface EnvStatus {
  node: DetectResult;
  phaserWx: DetectResult;
  coderAgents: CoderDetectResult[];
  detectedAt: string;
}

let cached: EnvStatus | null = null;

/**
 * Run environment detection for all components and cache the results.
 * Called at app startup. Safe to call multiple times (re-detects each time).
 */
export function runEnvDetection(): EnvStatus {
  console.log('[EnvCache] Running environment detection...');

  const node = detectNode();
  console.log('[EnvCache] Node.js: %s (path: %s)', node.found ? node.version : 'not found', node.path || '-');

  const phaserWx = detectPhaserWx();
  console.log('[EnvCache] phaser-wx: %s (path: %s)', phaserWx.found ? phaserWx.version : 'not found', phaserWx.path || '-');

  const coderAgents = detectAllCoders();
  for (const agent of coderAgents) {
    console.log('[EnvCache] Coder %s: %s (path: %s)', agent.agentName, agent.found ? agent.version : 'not found', agent.path || '-');
  }

  cached = {
    node,
    phaserWx,
    coderAgents,
    detectedAt: new Date().toISOString(),
  };

  return cached;
}

/**
 * Get the cached environment status. If not yet detected, runs detection.
 */
export function getEnvStatus(): EnvStatus {
  if (!cached) {
    return runEnvDetection();
  }
  return cached;
}

/**
 * Look up the absolute binary path for phaser-wx from the cache.
 * Returns 'phaser-wx' as fallback if not detected.
 */
export function getPhaserWxBinaryPath(): string {
  const status = getEnvStatus();
  return status.phaserWx.path || 'phaser-wx';
}

/**
 * Look up the absolute binary path for a coder agent.
 * Priority: manual path from config > auto-detected path from cache.
 * Returns null if neither is available.
 */
export function getCoderBinaryPath(agentId: CoderAgentId): string | null {
  // Check manual override in config first
  const config = readConfig();
  const manualPath = config.coderBinaryPaths?.[agentId];
  if (manualPath) return manualPath;

  // Fallback to auto-detected
  const status = getEnvStatus();
  const agent = status.coderAgents.find(a => a.agentId === agentId);
  return agent?.found ? agent.path : null;
}
