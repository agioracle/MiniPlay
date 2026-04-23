import { contextBridge, ipcRenderer } from 'electron';

export interface HydrationStep {
  id: string;
  label: string;
  status: 'pending' | 'checking' | 'installing' | 'done' | 'warning' | 'error';
  detail?: string;
  children?: HydrationStep[];
}

export type CoderAgentId = 'opencode' | 'claude-code' | 'codex' | 'gemini-cli';

export interface AppConfig {
  apiEndpoint: string;
  apiKey: string;
  model: string;
  coderAgent: CoderAgentId;
  hydrationComplete: boolean;
  coderBinaryPaths?: Partial<Record<CoderAgentId, string>>;
}

export interface CoderDetectResult {
  found: boolean;
  version: string | null;
  path: string | null;
  agentId: CoderAgentId;
  agentName: string;
  installInstructions?: string;
  installUrl?: string;
}

export interface AgentStreamEvent {
  type: 'text-delta' | 'tool-call' | 'tool-result' | 'coder-status' | 'coder-output' | 'gdd-updated' | 'done' | 'error' | 'status' | 'output' | 'agent-message';
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  batchId?: string;
  /**
   * Owning project for this event. Set to `null` only for pre-project GD
   * agent events (before `create_project` runs). Coder/auto-build/self-heal
   * events always carry a concrete path. Renderers filter by
   * `event.projectPath !== currentProject` to avoid cross-project leakage.
   */
  projectPath?: string | null;
  /**
   * Global monotonically increasing sequence number assigned by
   * `CoderSessionManager.emitEvent`. Only present on Coder-related events.
   * The renderer uses this to dedupe the subscribe-snapshot against the live
   * `agent:stream` tail.
   */
  seq?: number;
}

/**
 * A buffered Coder event as returned by `coder:subscribe`. Mirrors the
 * `BufferedEvent` shape defined in `electron/coder/coder-buffer.ts`.
 */
export interface BufferedCoderEvent {
  seq: number;
  batchId: string | null;
  type: 'status' | 'output' | 'tool-call' | 'tool-result' | 'agent-message';
  payload: Record<string, unknown>;
  at: number;
}

export interface CoderBufferSnapshot {
  events: BufferedCoderEvent[];
  lastSeq: number;
  batches: Array<{ batchId: string; started: boolean; done: boolean; status: string | null }>;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'coder' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  toolResults?: Array<{ toolCallId: string; result: unknown }>;
  images?: Array<{ name: string; mimeType: string; base64: string }>;
}

export interface ProjectEntry {
  name: string;
  path: string;
  template: string;
  lastOpened: string;
  versionCount: number;
  thumbnail: string | null;
}

export interface AssetNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: AssetNode[];
}

export interface MiniPlayAPI {
  // Echo test
  echo: (message: string) => Promise<string>;

  // Hydration
  hydrationCheck: () => Promise<boolean>;
  hydrationRun: () => Promise<boolean>;
  onHydrationProgress: (callback: (steps: HydrationStep[]) => void) => () => void;
  envStatus: () => Promise<{ node: any; phaserWx: any; coderAgents: CoderDetectResult[]; detectedAt: string }>;

  // Config
  configGet: () => Promise<AppConfig>;
  configSet: (partial: Partial<AppConfig>) => Promise<AppConfig>;

  // Agent
  agentSend: (payload: { message: string; projectPath?: string; images?: Array<{ name: string; mimeType: string; base64: string }> }) => Promise<{ text?: string; toolCalls?: unknown[]; projectCreated?: boolean; gddUpdated?: boolean; error?: string }>;
  agentHistory: (projectPath: string) => Promise<StoredMessage[]>;
  agentClearPending: () => Promise<{ success: boolean }>;
  onAgentStream: (callback: (event: AgentStreamEvent) => void) => () => void;

  // Coder Agent (direct mode — code phase)
  coderSend: (payload: { message: string; images?: Array<{ name: string; mimeType: string; base64: string }>; projectPath?: string }) => Promise<{ success: boolean; text?: string; changedFiles?: string[]; error?: string }>;
  /** Cancel the running Coder task for a project (SIGTERM → 3s → SIGKILL) and drop its pending queue. */
  coderCancel: (payload?: { projectPath?: string }) => Promise<{ cancelled: boolean; error?: string }>;
  /** Snapshot the CoderBuffer for replay after mounting/switching projects. Caller MUST attach onAgentStream first. */
  coderSubscribe: (payload?: { projectPath?: string }) => Promise<CoderBufferSnapshot>;
  /** Snapshot of project paths currently running a Coder task. */
  coderRunningList: () => Promise<{ runningPaths: string[] }>;
  /** Broadcast whenever the running-list changes (task started / finished / cancelled). */
  onCoderRunningChanged: (callback: (data: { runningPaths: string[] }) => void) => () => void;

  // Projects
  projectList: () => Promise<ProjectEntry[]>;
  projectOpen: (projectPath: string) => Promise<{ projectPath: string; messages: StoredMessage[]; gdd: string; versions: unknown; hasRunningCoder?: boolean; error?: string }>;
  projectActive: () => Promise<string | null>;
  /** Leave the current foreground project but keep its CoderSession running in background. Used when returning to home. */
  projectDeactivate: () => Promise<{ success: boolean }>;
  /** Fully close a project: deactivate + kill its CoderSession. Files on disk are preserved. */
  projectClose: (payload?: { projectPath?: string }) => Promise<{ success: boolean }>;
  projectResumePreview: (payload?: { projectPath?: string }) => Promise<{ success: boolean; url?: string; error?: string; builtIdle?: boolean }>;
  projectDelete: (projectPath: string) => Promise<{ success: boolean; error?: string }>;

  // Coder Agent
  coderDetect: () => Promise<CoderDetectResult>;
  coderDetectAll: () => Promise<CoderDetectResult[]>;

  // Preview
  previewRefresh: (payload?: { projectPath?: string }) => Promise<{ success: boolean; url?: string; error?: string; builtIdle?: boolean }>;
  previewState: () => Promise<{ running: boolean; port: number; url: string | null }>;
  previewStop: () => Promise<{ success: boolean }>;
  previewToggleDevtools: () => Promise<{ success: boolean }>;
  onPreviewStatus: (callback: (data: { status: string; url?: string; error?: string; projectPath?: string }) => void) => () => void;
  onPreviewRefresh: (callback: (data: { url: string; projectPath?: string }) => void) => () => void;
  previewRuntimeError: (data: { message?: string; source?: string; line?: number; stack?: string }) => Promise<{ handled: boolean; attempts?: number; batched?: boolean }>;

  // GDD
  gddRead: () => Promise<{ content: string; error?: string }>;
  gddWrite: (content: string) => Promise<{ success: boolean; error?: string }>;

  // Assets
  assetsList: () => Promise<{ tree: AssetNode[]; error?: string }>;
  assetsMove: (payload: { src: string; dest: string }) => Promise<{ success: boolean; error?: string }>;
  assetsAdd: (payload: { dirPath: string; fileName: string; fileBase64: string; fileMimeType: string }) => Promise<{ success: boolean; error?: string }>;
  assetsReplace: (payload: { targetPath: string; newFileBase64: string; newFileName: string; newFileMimeType: string }) => Promise<{ success: boolean; error?: string }>;
  assetsDelete: (payload: { filePath: string }) => Promise<{ success: boolean; error?: string }>;
  assetsRead: (payload: { filePath: string }) => Promise<{ base64?: string; mimeType?: string; error?: string }>;

  // Git / Time Travel
  gitVersions: (projectPath?: string) => Promise<{ versions: unknown[] }>;
  gitCommit: (payload: { summary: string; changedFiles?: string[]; triggerMessageId?: string }) => Promise<{ success: boolean; commitHash?: string; version?: string; error?: string }>;
  gitCheckout: (commitHash: string) => Promise<{ success: boolean; error?: string }>;
  gitReturnToLatest: () => Promise<{ success: boolean; error?: string }>;

  // Export
  exportConfig: () => Promise<{ appid?: string; cdn?: string; hasRemoteAssets?: boolean; error?: string }>;
  exportRun: (payload?: { appid?: string; cdn?: string }) => Promise<{ success?: boolean; zipPath?: string; size?: number; error?: string }>;
  onExportStatus: (callback: (data: { step: string }) => void) => () => void;

  // Generic stream listener
  onStreamMessage: (callback: (data: unknown) => void) => () => void;
}

const api: MiniPlayAPI = {
  echo: (message: string) => ipcRenderer.invoke('echo', message),

  hydrationCheck: () => ipcRenderer.invoke('hydration:check'),
  hydrationRun: () => ipcRenderer.invoke('hydration:run'),
  onHydrationProgress: (callback: (steps: HydrationStep[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, steps: HydrationStep[]) =>
      callback(steps);
    ipcRenderer.on('hydration:progress', handler);
    return () => ipcRenderer.removeListener('hydration:progress', handler);
  },
  envStatus: () => ipcRenderer.invoke('env:status'),

  configGet: () => ipcRenderer.invoke('config:get'),
  configSet: (partial: Partial<AppConfig>) => ipcRenderer.invoke('config:set', partial),

  agentSend: (payload: { message: string; projectPath?: string; images?: Array<{ name: string; mimeType: string; base64: string }> }) =>
    ipcRenderer.invoke('agent:send', payload),
  agentHistory: (projectPath: string) => ipcRenderer.invoke('agent:history', projectPath),
  agentClearPending: () => ipcRenderer.invoke('agent:clear-pending'),
  coderSend: (payload: { message: string; images?: Array<{ name: string; mimeType: string; base64: string }>; projectPath?: string }) =>
    ipcRenderer.invoke('coder:send', payload),
  coderCancel: (payload?: { projectPath?: string }) => ipcRenderer.invoke('coder:cancel', payload),
  coderSubscribe: (payload?: { projectPath?: string }) => ipcRenderer.invoke('coder:subscribe', payload),
  coderRunningList: () => ipcRenderer.invoke('coder:running-list'),
  onCoderRunningChanged: (callback: (data: { runningPaths: string[] }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { runningPaths: string[] }) => callback(data);
    ipcRenderer.on('coder:running-changed', handler);
    return () => ipcRenderer.removeListener('coder:running-changed', handler);
  },
  onAgentStream: (callback: (event: AgentStreamEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentStreamEvent) =>
      callback(data);
    ipcRenderer.on('agent:stream', handler);
    return () => ipcRenderer.removeListener('agent:stream', handler);
  },

  projectList: () => ipcRenderer.invoke('project:list'),
  projectOpen: (projectPath: string) => ipcRenderer.invoke('project:open', projectPath),
  projectActive: () => ipcRenderer.invoke('project:active'),
  projectDeactivate: () => ipcRenderer.invoke('project:deactivate'),
  projectClose: (payload?: { projectPath?: string }) => ipcRenderer.invoke('project:close', payload),
  projectResumePreview: (payload?: { projectPath?: string }) => ipcRenderer.invoke('project:resume-preview', payload),
  projectDelete: (projectPath: string) => ipcRenderer.invoke('project:delete', projectPath),

  coderDetect: () => ipcRenderer.invoke('coder:detect'),
  coderDetectAll: () => ipcRenderer.invoke('coder:detect-all'),

  previewRefresh: (payload?: { projectPath?: string }) => ipcRenderer.invoke('preview:refresh', payload),
  previewState: () => ipcRenderer.invoke('preview:state'),
  previewStop: () => ipcRenderer.invoke('preview:stop'),
  previewToggleDevtools: () => ipcRenderer.invoke('preview:toggle-devtools'),
  onPreviewStatus: (callback: (data: { status: string; url?: string; error?: string; projectPath?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('preview:status', handler);
    return () => ipcRenderer.removeListener('preview:status', handler);
  },
  onPreviewRefresh: (callback: (data: { url: string; projectPath?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('preview:refresh', handler);
    return () => ipcRenderer.removeListener('preview:refresh', handler);
  },
  previewRuntimeError: (data: { message?: string; source?: string; line?: number; stack?: string }) =>
    ipcRenderer.invoke('preview:runtime-error', data),

  gddRead: () => ipcRenderer.invoke('gdd:read'),
  gddWrite: (content: string) => ipcRenderer.invoke('gdd:write', content),

  assetsList: () => ipcRenderer.invoke('assets:list'),
  assetsMove: (payload: { src: string; dest: string }) => ipcRenderer.invoke('assets:move', payload),
  assetsAdd: (payload: { dirPath: string; fileName: string; fileBase64: string; fileMimeType: string }) => ipcRenderer.invoke('assets:add', payload),
  assetsReplace: (payload: { targetPath: string; newFileBase64: string; newFileName: string; newFileMimeType: string }) => ipcRenderer.invoke('assets:replace', payload),
  assetsDelete: (payload: { filePath: string }) => ipcRenderer.invoke('assets:delete', payload),
  assetsRead: (payload: { filePath: string }) => ipcRenderer.invoke('assets:read', payload),

  gitVersions: (projectPath?: string) => ipcRenderer.invoke('git:versions', projectPath),
  gitCommit: (payload: { summary: string; changedFiles?: string[]; triggerMessageId?: string }) =>
    ipcRenderer.invoke('git:commit', payload),
  gitCheckout: (commitHash: string) => ipcRenderer.invoke('git:checkout', commitHash),
  gitReturnToLatest: () => ipcRenderer.invoke('git:return-to-latest'),

  exportConfig: () => ipcRenderer.invoke('export:config'),
  exportRun: (payload?: { appid?: string; cdn?: string }) => ipcRenderer.invoke('export:run', payload),
  onExportStatus: (callback: (data: { step: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('export:status', handler);
    return () => ipcRenderer.removeListener('export:status', handler);
  },

  onStreamMessage: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('stream:message', handler);
    return () => ipcRenderer.removeListener('stream:message', handler);
  },
};

contextBridge.exposeInMainWorld('miniplay', api);
