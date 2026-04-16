import * as fs from 'fs';
import * as path from 'path';
import { ensureDir } from '../storage/paths';

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'coder' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  toolResults?: Array<{
    toolCallId: string;
    result: unknown;
  }>;
  /** Image attachments (base64 encoded) */
  images?: Array<{
    name: string;
    mimeType: string;
    base64: string;
  }>;
}

/**
 * Append a message to the project's conversations.jsonl
 */
export function appendMessage(projectPath: string, message: StoredMessage): void {
  const miniplayDir = path.join(projectPath, '.miniplay');
  ensureDir(miniplayDir);
  const filePath = path.join(miniplayDir, 'conversations.jsonl');
  fs.appendFileSync(filePath, JSON.stringify(message) + '\n', 'utf-8');
}

/**
 * Read all messages from the project's conversations.jsonl
 */
export function readMessages(projectPath: string): StoredMessage[] {
  const filePath = path.join(projectPath, '.miniplay', 'conversations.jsonl');
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];

  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line) as StoredMessage;
      } catch {
        return null;
      }
    })
    .filter((m): m is StoredMessage => m !== null);
}
