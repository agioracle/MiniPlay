/**
 * Registry of supported Coder Agent CLIs.
 *
 * Each entry defines how to detect, invoke, and install a coding agent.
 * MiniPlay supports multiple coding agents — the user chooses one in Settings.
 */

export type CoderAgentId = 'opencode' | 'claude-code' | 'codex' | 'gemini-cli';

export interface CoderAgentDef {
  id: CoderAgentId;
  name: string;
  description: string;

  /** Shell command to check version (used for detection) */
  detectCmd: string;

  /** Shell command to find the binary path */
  whichCmd: string;

  /**
   * Build the CLI invocation args for non-interactive code modification.
   * @param prompt - The full prompt text
   * @param binPath - Optional absolute path to the binary (from env-cache detection)
   * @param sessionId - Optional session ID for resuming a previous session
   * @returns [binary, ...args]
   */
  buildCommand: (prompt: string, binPath?: string, sessionId?: string) => [string, ...string[]];

  /** Whether this agent outputs structured JSON that can be parsed line-by-line */
  jsonOutput: boolean;

  /** Environment variables to set for non-interactive mode */
  env?: Record<string, string>;

  /** Installation instructions shown to the user */
  installInstructions: string;

  /** Install URL for the user to visit */
  installUrl: string;
}

export const CODER_AGENTS: Record<CoderAgentId, CoderAgentDef> = {
  'opencode': {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Anthropic\'s open-source AI coding agent',
    detectCmd: 'opencode --version',
    whichCmd: 'which opencode',
    buildCommand: (prompt, binPath?, sessionId?) => [
      binPath || 'opencode', 'run',
      '--prompt', prompt,
      '--format', 'json',
      ...(sessionId ? ['--session', sessionId] : []),
    ],
    jsonOutput: true,
    env: { CI: 'true' },
    installInstructions: 'npm install -g opencode-ai',
    installUrl: 'https://opencode.ai',
  },

  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic\'s Claude Code CLI',
    detectCmd: 'claude-internal --version',
    whichCmd: 'which claude-internal',
    buildCommand: (prompt, binPath?, sessionId?) => [
      binPath || 'claude', '-p', prompt,
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'bypassPermissions',
      '--dangerously-skip-permissions',
      ...(sessionId ? ['--resume', sessionId] : []),
    ],
    jsonOutput: true,
    env: { CI: 'true' },
    installInstructions: 'npm install -g @anthropic-ai/claude-code',
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  },

  'codex': {
    id: 'codex',
    name: 'Codex CLI',
    description: 'OpenAI\'s Codex CLI agent',
    detectCmd: 'codex-internal --version',
    whichCmd: 'which codex-internal',
    buildCommand: (prompt, binPath?, sessionId?) => [
      binPath || 'codex',
      ...(sessionId ? ['exec', '--resume', sessionId] : []),
      '--quiet', '--full-auto', '--json',
      prompt,
    ],
    jsonOutput: true,
    env: {},
    installInstructions: 'npm install -g @openai/codex',
    installUrl: 'https://github.com/openai/codex',
  },

  'gemini-cli': {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: 'Google\'s Gemini CLI agent',
    detectCmd: 'gemini-internal --version',
    whichCmd: 'which gemini-internal',
    buildCommand: (prompt, binPath?, sessionId?) => [
      binPath || 'gemini', '-p', prompt,
      '--output-format', 'stream-json',
      '--yolo',
      ...(sessionId ? ['--resume', sessionId] : []),
    ],
    jsonOutput: true,
    env: {},
    installInstructions: 'npm install -g @anthropic-ai/gemini-cli\n(or visit the URL below)',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
  },
};

export const CODER_AGENT_IDS = Object.keys(CODER_AGENTS) as CoderAgentId[];

/**
 * Priority order for auto-selection when multiple agents are installed.
 * First found wins.
 */
export const CODER_AGENT_PRIORITY: CoderAgentId[] = [
  'claude-code',
  'codex',
  'gemini-cli',
  'opencode',
];

export const DEFAULT_CODER_AGENT: CoderAgentId = 'claude-code';
