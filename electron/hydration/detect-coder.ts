import { execSync } from 'child_process';
import type { DetectResult } from './detect-node';
import { CODER_AGENTS, DEFAULT_CODER_AGENT, CODER_AGENT_IDS, type CoderAgentId, type CoderAgentDef } from '../coder/agents';
import { readConfig } from '../storage/config';

export interface CoderDetectResult extends DetectResult {
  agentId: CoderAgentId;
  agentName: string;
  installInstructions?: string;
  installUrl?: string;
}

/**
 * Detect a single coder agent by its definition.
 */
function detectAgent(agent: CoderAgentDef): DetectResult {
  try {
    const raw = execSync(agent.detectCmd, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    }).trim();
    // Some agents output multiple lines; only keep the first line
    const version = raw.split('\n')[0].trim();
    const agentPath = execSync(agent.whichCmd, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: 'pipe',
    }).trim();
    return { found: true, version, path: agentPath };
  } catch {
    return { found: false, version: null, path: null };
  }
}

/**
 * Detect the currently configured coder agent.
 * If not found, returns install instructions for the user.
 */
export function detectConfiguredCoder(): CoderDetectResult {
  const config = readConfig();
  const agentId = (config.coderAgent || DEFAULT_CODER_AGENT) as CoderAgentId;
  const agent = CODER_AGENTS[agentId] || CODER_AGENTS[DEFAULT_CODER_AGENT];

  const result = detectAgent(agent);

  return {
    ...result,
    agentId: agent.id,
    agentName: agent.name,
    installInstructions: result.found ? undefined : agent.installInstructions,
    installUrl: result.found ? undefined : agent.installUrl,
  };
}

/**
 * Detect ALL available coder agents on the system.
 * Used by the Settings UI to show which agents are installed.
 */
export function detectAllCoders(): CoderDetectResult[] {
  return CODER_AGENT_IDS.map((id) => {
    const agent = CODER_AGENTS[id];
    const result = detectAgent(agent);
    return {
      ...result,
      agentId: agent.id,
      agentName: agent.name,
      installInstructions: result.found ? undefined : agent.installInstructions,
      installUrl: result.found ? undefined : agent.installUrl,
    };
  });
}
