import type { BrowserWindow } from 'electron';
import { refreshPreview } from './preview-bridge';

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
}

export interface AutoBuildOptions {
  /** Electron main window used to dispatch agent:stream events. */
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
 *   - Invoke `refreshPreview()` which handles build + vite server + self-heal.
 *   - Emit a `tool-result` event with the full build result so the UI can show
 *     duration / preview URL / error details.
 *   - Never throw: any exception from `refreshPreview` is caught and surfaced
 *     via the `tool-result` event's `result.error`.
 *
 * Event channel: `agent:stream` (payload carries `batchId`).
 * This matches the existing protocol used by `send-to-coder.ts` and `ipc/coder.ts`.
 */
export async function autoBuildAfterCoder(
  options: AutoBuildOptions,
): Promise<AutoBuildResult> {
  const { win, batchId } = options;
  const toolCallId = options.toolCallId || `build_auto_${batchId}`;

  console.log('[auto-build] starting (batchId=%s)...', batchId);

  if (win) {
    win.webContents.send('agent:stream', {
      type: 'tool-call',
      toolCallId,
      toolName: 'trigger_build',
      batchId,
    });
  }

  let result: AutoBuildResult;
  try {
    const buildResult = await refreshPreview(win || undefined);
    result = buildResult;
    const durationSec = ((buildResult.buildDuration || 0) / 1000).toFixed(1);
    console.log(
      '[auto-build] %s (%ss)%s',
      buildResult.success ? 'success' : 'failed',
      durationSec,
      buildResult.selfHealed ? ' [self-healed]' : '',
    );
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error('[auto-build] exception:', message);
    result = { success: false, error: message };
  }

  if (win) {
    win.webContents.send('agent:stream', {
      type: 'tool-result',
      toolCallId,
      result,
      batchId,
    });
  }

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
    if (result.selfHealed) parts.push(' (self-healed)');
    parts.push('.');
    return parts.join('');
  }
  return ` Build FAILED: ${result.error || 'unknown error'}.`;
}
