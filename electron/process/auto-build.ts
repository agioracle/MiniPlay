import type { BrowserWindow } from 'electron';
import { refreshPreview } from './preview-bridge';
import { coderSessionManager } from '../coder/session-manager';

/**
 * Result payload shape emitted for the `build_auto` tool-result event.
 * Mirrors the shape of refreshPreview's return value plus a normalized
 * `error` string when an exception is caught.
 */
export interface AutoBuildResult {
  success: boolean;
  url?: string;
  error?: string;
  buildDuration?: number;
  selfHealed?: boolean;
  /** True when the build produced artifacts but the project is not in foreground, so no vite serve was started. */
  builtIdle?: boolean;
}

export interface AutoBuildOptions {
  /**
   * Project this build belongs to. REQUIRED — vite serve will only start if
   * this project is currently the foreground (active) one, but the build
   * itself always runs to keep `dist-h5` fresh for when the user switches
   * back.
   */
  projectPath: string;
  /** Electron main window used to dispatch agent:stream events (for broadcast fallback paths). */
  win: BrowserWindow | null | undefined;
  /** Batch id attached to every agent:stream event so the UI can group them. */
  batchId: string;
  /** Tool-call id used for this build. Defaults to `build_auto_${batchId}`. */
  toolCallId?: string;
}

/**
 * Trigger an H5 rebuild after the Coder Agent reports success.
 *
 * Responsibilities:
 *   - Emit a `tool-call` event (toolName=`trigger_build`) to mark build start in UI.
 *   - Invoke `refreshPreview(projectPath, win)` which handles build + vite server + self-heal.
 *     Build always runs; vite serve only starts when the project is foreground.
 *   - Emit a `tool-result` event with the full build result so the UI can show
 *     duration / preview URL / error details.
 *   - Never throw: any exception from `refreshPreview` is caught and surfaced
 *     via the `tool-result` event's `result.error`.
 *
 * Event channel: `agent:stream`, routed exclusively through
 * `coderSessionManager.emitEvent(projectPath, ...)` — never call
 * `webContents.send('agent:stream', ...)` directly, otherwise events will not
 * be captured in the CoderBuffer and cross-project replay will break.
 */
export async function autoBuildAfterCoder(
  options: AutoBuildOptions,
): Promise<AutoBuildResult> {
  const { projectPath, win, batchId } = options;
  const toolCallId = options.toolCallId || `build_auto_${batchId}`;

  console.log('[auto-build] starting (project=%s, batchId=%s)...', projectPath, batchId);

  coderSessionManager.emitEvent(projectPath, {
    batchId,
    type: 'tool-call',
    payload: {
      toolCallId,
      toolName: 'trigger_build',
    },
  });

  let result: AutoBuildResult;
  try {
    const buildResult = await refreshPreview(projectPath, win || undefined);
    result = buildResult;
    const durationSec = ((buildResult.buildDuration || 0) / 1000).toFixed(1);
    console.log(
      '[auto-build] %s (%ss)%s%s',
      buildResult.success ? 'success' : 'failed',
      durationSec,
      buildResult.selfHealed ? ' [self-healed]' : '',
      buildResult.builtIdle ? ' [built-idle: background project]' : '',
    );
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error('[auto-build] exception:', message);
    result = { success: false, error: message };
  }

  coderSessionManager.emitEvent(projectPath, {
    batchId,
    type: 'tool-result',
    payload: {
      toolCallId,
      result,
    },
  });

  return result;
}

/**
 * Convenience: build the human-readable summary string appended to the
 * coder tool's final `message` field. Centralized here so the two call
 * sites stay in sync.
 */
export function formatAutoBuildSummary(result: AutoBuildResult): string {
  if (result.success) {
    const durationSec = ((result.buildDuration || 0) / 1000).toFixed(1);
    const parts = [` Build completed in ${durationSec}s`];
    if (result.url) parts.push(`, preview at ${result.url}`);
    else if (result.builtIdle) parts.push(' (background project — serve deferred)');
    if (result.selfHealed) parts.push(' (self-healed)');
    parts.push('.');
    return parts.join('');
  }
  return ` Build FAILED: ${result.error || 'unknown error'}.`;
}
