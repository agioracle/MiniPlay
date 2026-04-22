import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { runCoderAgent } from '../../coder/coder-runner';
import { updateGddSection } from '../../project/gdd';
import { getActiveProject } from '../../project/state';
import { refreshPreview } from '../../process/preview-bridge';
import { BrowserWindow } from 'electron';

const inputSchema = zodSchema(
  z.object({
    summary: z.string().describe('Brief summary of what needs to change'),
  })
);

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
    const coderToolCallId = `coder_${Date.now()}`;

    const sendCoderStatus = (status: string) => {
      if (win) {
        win.webContents.send('agent:stream', {
          type: 'coder-status',
          toolCallId: coderToolCallId,
          batchId: coderToolCallId,
          text: status,
        });
      }
    };
    const sendOutput = (line: string) => {
      if (win) {
        win.webContents.send('agent:stream', {
          type: 'coder-output',
          batchId: coderToolCallId,
          text: line,
        });
      }
    };

    try {
      // Emit a batch-identified tool-call so ChatPanel creates a new coder bubble
      if (win) {
        win.webContents.send('agent:stream', {
          type: 'tool-call',
          toolCallId: coderToolCallId,
          toolName: 'send_to_coder',
          batchId: coderToolCallId,
        });
      }
      sendCoderStatus('launching');
      console.log('[send_to_coder] Launching coder agent...');

      const result = await runCoderAgent({
        projectPath,
        summary: input.summary,
        onStatus: (status) => sendCoderStatus(status),
        onOutput: sendOutput,
      });

      sendCoderStatus(result.success ? 'done' : 'failed');
      // Send done event with batchId so frontend marks the coder batch as completed
      if (win) {
        win.webContents.send('agent:stream', {
          type: 'done',
          batchId: coderToolCallId,
        });
      }
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

      // Auto-trigger H5 build when coder succeeded AND actually changed files.
      // This runs strictly after runCoderAgent resolves, so "Working..." and
      // "Building..." never overlap in the UI. See plan fix-gdd-confirm-concurrent-build.
      let buildSummary = '';
      if (result.success && result.changedFiles.length > 0) {
        const buildAutoId = `build_auto_${coderToolCallId}`;
        console.log('[send_to_coder] Auto-build: starting...');
        if (win) {
          win.webContents.send('agent:stream', {
            type: 'tool-call',
            toolCallId: buildAutoId,
            toolName: 'trigger_build',
          });
        }
        try {
          const buildResult = await refreshPreview(win || undefined);
          const durationSec = ((buildResult.buildDuration || 0) / 1000).toFixed(1);
          console.log('[send_to_coder] Auto-build: %s (%ss)', buildResult.success ? 'success' : 'failed', durationSec);
          if (win) {
            win.webContents.send('agent:stream', {
              type: 'tool-result',
              toolCallId: buildAutoId,
              result: buildResult,
            });
          }
          buildSummary = buildResult.success
            ? ` Build completed in ${durationSec}s${buildResult.url ? `, preview at ${buildResult.url}` : ''}${buildResult.selfHealed ? ' (self-healed)' : ''}.`
            : ` Build FAILED: ${buildResult.error || 'unknown error'}.`;
        } catch (buildErr: any) {
          console.error('[send_to_coder] Auto-build exception:', buildErr?.message);
          if (win) {
            win.webContents.send('agent:stream', {
              type: 'tool-result',
              toolCallId: buildAutoId,
              result: { success: false, error: buildErr?.message },
            });
          }
          buildSummary = ` Build errored: ${buildErr?.message || buildErr}.`;
        }
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
