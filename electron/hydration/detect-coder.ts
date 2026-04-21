import { execSync } from 'child_process';
import * as path from 'path';
import type { DetectResult } from './detect-node';
import { CODER_AGENTS, DEFAULT_CODER_AGENT, CODER_AGENT_IDS, type CoderAgentId, type CoderAgentDef } from '../coder/agents';
import { readConfig } from '../storage/config';
import { findInNvmBin } from './nvm-utils';

export interface CoderDetectResult extends DetectResult {
  agentId: CoderAgentId;
  agentName: string;
  installInstructions?: string;
  installUrl?: string;
}

/**
 * Detect a single coder agent by trying its commands in priority order.
 * Returns the first successful detection result.
 *
 * When `which` fails, falls back to scanning nvm's global bin directory
 * as a supplementary detection mechanism (handles cases where PATH
 * recovery didn't pick up nvm-installed CLIs).
 */
function detectAgent(agent: CoderAgentDef): DetectResult {
  for (let i = 0; i < agent.detectCmds.length; i++) {
    try {
      const raw = execSync(agent.detectCmds[i], {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'pipe',
      }).trim();
      // Some agents output multiple lines; only keep the first line
      const version = raw.split('\n')[0].trim();
      const agentPath = execSync(agent.whichCmds[i], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe',
      }).trim();
      return { found: true, version, path: agentPath };
    } catch {
      // Try next command
    }
  }

  // Supplementary: try to find the executable in nvm's bin directory.
  // This handles the case where `which` fails because PATH doesn't include nvm paths.
  for (let i = 0; i < agent.whichCmds.length; i++) {
    // Extract binary name from whichCmds (e.g. "which claude" → "claude")
    const parts = agent.whichCmds[i].split(/\s+/);
    const binName = parts[parts.length - 1];
    const nvmPath = findInNvmBin(binName);
    if (nvmPath) {
      // Verify the binary actually works by running its detect command with full path
      try {
        const detectCmd = agent.detectCmds[i].replace(binName, nvmPath);
        const raw = execSync(detectCmd, {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: 'pipe',
        }).trim();
        const version = raw.split('\n')[0].trim();
        console.log(`[PATH] Detected '${agent.id}' via nvm bin scan: ${nvmPath}`);
        return { found: true, version, path: nvmPath };
      } catch {
        // Binary exists but doesn't work, continue
      }
    }
  }

  return { found: false, version: null, path: null };
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
