import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { runCoderAgent } from '../../coder/coder-runner';
import { updateGddSection } from '../../project/gdd';
import { getActiveProject } from '../../project/state';
import { autoBuildAfterCoder, formatAutoBuildSummary } from '../../process/auto-build';
import { BrowserWindow } from 'electron';
import { coderSessionManager } from '../../coder/session-manager';

const inputSchema = zodSchema(
  z.object({
    summary: z.string().describe('Brief summary of what needs to change'),
  })
);

/**
 * `send_to_coder` — GD Agent → Coder Agent bridge. Invoked inside a GD
 * `streamText` turn, so the tool itself has no access to a projectPath
 * argument. We resolve `projectPath` via `getActiveProject()` (since
 * `create_project` must have already set it). All agent:stream events below
 * are Coder-related and therefore routed through `coderSessionManager.emitEvent`
 * — never `win.webContents.send('agent:stream', ...)` directly.
 */
export const sendToCoderTool = tool({
  description: 'Send the latest GDD patch to the Coder Agent for implementation. The Coder will read the GDD Latest Patch and modify source code accordingly. On success, this tool AUTOMATICALLY triggers an H5 build — you do NOT need to call trigger_build separately.',
  inputSchema,
  execute: async (input) => {
    const projectPath = getActiveProject();
    console.log('[send_to_coder] Called with summary:', input.summary.slice(0, 100));
    console.log('[send_to_coder] Active project:', projectPath || '(none)');

    if (!projectPath) {
      return {
        success: false,
        status: 'failed' as const,
        changedFiles: [] as string[],
        message: 'No active project. Call create_project first.',
      };
    }

    const win = BrowserWindow.getAllWindows()[0];
    // Globally-unique batchId (replaces legacy `coder_${Date.now()}`).
    const batchId = coderSessionManager.startBatch(projectPath);

    const emit = (
      type: 'status' | 'output' | 'tool-call' | 'tool-result' | 'agent-message',
      payload: Record<string, unknown>,
    ) => {
      coderSessionManager.emitEvent(projectPath, {
        batchId,
        type,
        payload,
      });
    };

    const sendCoderStatus = (status: string) => {
      emit('status', { toolCallId: batchId, text: status });
    };
    const sendOutput = (line: string) => {
      emit('output', { text: line });
    };

    try {
      const result = await runCoderAgent({
        projectPath,
        summary: input.summary,
        onStatus: (status) => sendCoderStatus(status),
        onOutput: sendOutput,
        onDequeue: () => {
          // Register batchId + first visible events at dequeue time so
          // `coder:cancel` can correctly attribute the `__cancelled` marker
          // to THIS batch even if another same-project task is already
          // queued behind. This path previously had NO `setCurrentBatchId`
          // call at all, so cancel used to silently miss send_to_coder runs.
          coderSessionManager.setCurrentBatchId(projectPath, batchId);
          emit('tool-call', { toolCallId: batchId, toolName: 'send_to_coder' });
          sendCoderStatus('launching');
          console.log('[send_to_coder] Launching coder agent...');
        },
      });

      sendCoderStatus(result.success ? 'done' : 'failed');
      // Mark the batch as done.
      emit('tool-result', { toolCallId: batchId });
      console.log('[send_to_coder] Coder result: %s, changed files: %s', result.status, result.changedFiles.join(', ') || '(none)');
      if (result.error) console.error('[send_to_coder] Coder error:', result.error);

      if (result.success) {
        updateGddSection(
          projectPath,
          'Latest Patch',
          `- [${new Date().toISOString()}] [DONE] ${input.summary}\n  Changed files: ${result.changedFiles.join(', ')}\n  Agent: ${result.agentUsed}`,
        );
      } else {
        // Record failure in GDD so future coder runs have context and the user
        // can see what went wrong in the project's own history.
        const errSnippet = (result.error || 'unknown error').replace(/\s+/g, ' ').slice(0, 240);
        updateGddSection(
          projectPath,
          'Latest Patch',
          `- [${new Date().toISOString()}] [FAILED] ${input.summary}\n  Agent: ${result.agentUsed}\n  Error: ${errSnippet}${result.changedFiles.length > 0 ? `\n  Partial changes left on disk: ${result.changedFiles.join(', ')}` : ''}`,
        );
      }

      // Auto-trigger H5 build when coder succeeded. We no longer gate on
      // `changedFiles.length > 0`: set-diff of `git status --porcelain` misses
      // coder auto-commits and repeated edits to already-dirty files, and a
      // true no-op rebuild is cheap (vite is incremental). See plan
      // fix-rebuild-not-triggered-after-coder.
      let buildSummary = '';
      if (result.success) {
        const buildResult = await autoBuildAfterCoder({
          projectPath,
          win,
          batchId,
          toolCallId: `build_auto_${batchId}`,
        });
        buildSummary = formatAutoBuildSummary(buildResult);
      }

      return {
        success: result.success,
        status: result.status,
        changedFiles: result.changedFiles,
        message: result.success
          ? `Code updated by ${result.agentUsed}. Changed files: ${result.changedFiles.join(', ')}.${buildSummary}`
          : result.error?.includes('ENOENT')
            ? `Coder Agent "${result.agentUsed}" binary not found. Please check that it is installed and accessible from your PATH. You can verify in Settings. Do NOT retry — the user needs to fix the installation first.`
            : `CODER FAILED (${result.agentUsed}). Error: ${(result.error || 'unknown').slice(0, 400)}. ${result.changedFiles.length > 0 ? `WARNING: ${result.changedFiles.length} partial file(s) left on disk: ${result.changedFiles.slice(0, 5).join(', ')}${result.changedFiles.length > 5 ? ', ...' : ''}. Do NOT claim success. ` : ''}Do NOT retry the same request automatically — inform the user about the failure and ask how to proceed.`,
      };
    } catch (err: any) {
      console.error('[send_to_coder] Exception:', err.message);
      return {
        success: false,
        status: 'failed' as const,
        changedFiles: [] as string[],
        message: `Coder Agent error: ${err.message}`,
      };
    }
  },
});
