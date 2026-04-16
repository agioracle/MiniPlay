import { detectNode, type DetectResult } from './detect-node';
import { detectPhaserWx } from './detect-phaser-wx';
import { detectAllCoders, type CoderDetectResult } from './detect-coder';
import type { CoderAgentId } from '../coder/agents';

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
 * Look up the absolute binary path for a coder agent from the cache.
 * Returns null if the agent was not detected or has no path.
 */
export function getCoderBinaryPath(agentId: CoderAgentId): string | null {
  const status = getEnvStatus();
  const agent = status.coderAgents.find(a => a.agentId === agentId);
  return agent?.found ? agent.path : null;
}
