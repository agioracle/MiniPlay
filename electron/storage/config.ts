import * as fs from 'fs';
import { CONFIG_PATH, ensureMiniPlayHome } from './paths';
import type { CoderAgentId } from '../coder/agents';

export interface AppConfig {
  /** Base URL for the LLM API (OpenAI-compatible endpoint) */
  apiEndpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Model identifier, e.g. "claude-sonnet-4-20250514", "gpt-4o", "deepseek-chat" */
  model: string;
  /** Selected coder agent CLI */
  coderAgent: CoderAgentId;
  /** Whether first-launch hydration has completed */
  hydrationComplete: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  apiEndpoint: '',
  apiKey: '',
  model: '',
  coderAgent: 'claude-code',
  hydrationComplete: false,
};

export function readConfig(): AppConfig {
  ensureMiniPlayHome();
  if (!fs.existsSync(CONFIG_PATH)) {
    writeConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);

    // Migration: old config with apiProvider → new apiEndpoint
    if (parsed.apiProvider && !parsed.apiEndpoint) {
      parsed.apiEndpoint = parsed.apiProvider === 'openai'
        ? 'https://api.openai.com/v1'
        : 'https://api.anthropic.com/v1';
      delete parsed.apiProvider;
    }

    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: Partial<AppConfig>): void {
  ensureMiniPlayHome();
  const current = fs.existsSync(CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    : DEFAULT_CONFIG;
  const merged = { ...current, ...config };
  // Clean up legacy field
  delete (merged as any).apiProvider;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
}
