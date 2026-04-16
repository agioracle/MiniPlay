import * as fs from 'fs';
import * as path from 'path';
import { ensureDir } from '../storage/paths';
import type { CoderAgentId } from './agents';

export interface CoderSession {
  sessionId: string;
  agentId: CoderAgentId;
  createdAt: string;
}

const SESSION_FILE = 'coder-session.json';

/**
 * Read the coder session for a project.
 * Returns null if no session exists or if the stored agent differs from current.
 */
export function readSession(projectPath: string, currentAgentId: CoderAgentId): CoderSession | null {
  const filePath = path.join(projectPath, '.miniplay', SESSION_FILE);
  if (!fs.existsSync(filePath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CoderSession;
    // Only resume if the same agent — different agents have incompatible sessions
    if (data.agentId !== currentAgentId) {
      console.log('[Session] Agent changed (%s → %s), discarding old session', data.agentId, currentAgentId);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Save/update the coder session for a project.
 */
export function writeSession(projectPath: string, sessionId: string, agentId: CoderAgentId): void {
  const miniplayDir = path.join(projectPath, '.miniplay');
  ensureDir(miniplayDir);

  const data: CoderSession = {
    sessionId,
    agentId,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(miniplayDir, SESSION_FILE),
    JSON.stringify(data, null, 2),
    'utf-8',
  );
  console.log('[Session] Saved session %s for agent %s', sessionId, agentId);
}

/**
 * Clear the coder session for a project.
 */
export function clearSession(projectPath: string): void {
  const filePath = path.join(projectPath, '.miniplay', SESSION_FILE);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log('[Session] Cleared session for %s', projectPath);
  }
}
