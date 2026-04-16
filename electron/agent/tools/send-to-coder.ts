import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { runCoderAgent } from '../../coder/coder-runner';
import { updateGddSection } from '../../project/gdd';
import { getActiveProject } from '../../project/state';
import { BrowserWindow } from 'electron';

const inputSchema = zodSchema(
  z.object({
    summary: z.string().describe('Brief summary of what needs to change'),
  })
);

export const sendToCoderTool = tool({
  description: 'Send the latest GDD patch to the Coder Agent for implementation. The Coder will read the GDD Latest Patch and modify source code accordingly.',
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
          text: status,
        });
      }
    };
    const sendOutput = (line: string) => {
      if (win) {
        win.webContents.send('agent:stream', {
          type: 'coder-output',
          text: line,
        });
      }
    };

    try {
      sendCoderStatus('launching');
      console.log('[send_to_coder] Launching coder agent...');

      const result = await runCoderAgent({
        projectPath,
        summary: input.summary,
        onStatus: (status) => sendCoderStatus(status),
        onOutput: sendOutput,
      });

      sendCoderStatus(result.success ? 'done' : 'failed');
      console.log('[send_to_coder] Coder result: %s, changed files: %s', result.status, result.changedFiles.join(', ') || '(none)');
      if (result.error) console.error('[send_to_coder] Coder error:', result.error);

      if (result.success) {
        updateGddSection(
          projectPath,
          'Latest Patch',
          `- [${new Date().toISOString()}] [DONE] ${input.summary}\n  Changed files: ${result.changedFiles.join(', ')}\n  Agent: ${result.agentUsed}`,
        );
      }

      return {
        success: result.success,
        status: result.status,
        changedFiles: result.changedFiles,
        message: result.success
          ? `Code updated by ${result.agentUsed}. Changed files: ${result.changedFiles.join(', ')}`
          : result.error?.includes('ENOENT')
            ? `Coder Agent "${result.agentUsed}" binary not found. Please check that it is installed and accessible from your PATH. You can verify in Settings. Do NOT retry — the user needs to fix the installation first.`
            : `Code modification failed (${result.agentUsed}): ${result.error}. Do NOT retry the same request — inform the user about the error.`,
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
