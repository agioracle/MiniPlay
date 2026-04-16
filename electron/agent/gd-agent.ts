import { streamText, stepCountIs, type ModelMessage, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { BrowserWindow } from 'electron';
import { GD_SYSTEM_PROMPT } from './system-prompt';
import { createProjectTool } from './tools/create-project';
import { updateGddTool } from './tools/update-gdd';
import { sendToCoderTool } from './tools/send-to-coder';
import { triggerBuildTool } from './tools/trigger-build';
import { triggerExportTool } from './tools/trigger-export';
import { readConfig } from '../storage/config';

/**
 * Known API endpoint patterns to determine which SDK provider to use.
 * Anthropic API requires @ai-sdk/anthropic; everything else uses @ai-sdk/openai
 * (which supports any OpenAI-compatible endpoint).
 */
function isAnthropicEndpoint(endpoint: string): boolean {
  return endpoint.includes('anthropic.com');
}

function getModel(): LanguageModel {
  const config = readConfig();
  const { apiEndpoint, apiKey, model } = config;

  if (isAnthropicEndpoint(apiEndpoint)) {
    const anthropic = createAnthropic({
      apiKey,
      baseURL: apiEndpoint,
    });
    return anthropic(model || 'claude-sonnet-4-20250514');
  }

  // OpenAI-compatible: use .chat() to force /chat/completions endpoint
  // (default .call() uses /responses which is OpenAI-proprietary)
  const openai = createOpenAI({
    apiKey,
    baseURL: apiEndpoint,
  });
  return openai.chat(model || 'gpt-4o');
}

const tools = {
  create_project: createProjectTool,
  update_gdd: updateGddTool,
  send_to_coder: sendToCoderTool,
  trigger_build: triggerBuildTool,
  trigger_export: triggerExportTool,
};

/**
 * Run one GD Agent turn: stream LLM response with tool calling.
 * Sends incremental updates to renderer via IPC.
 */
export async function runGdAgentTurn(
  messages: ModelMessage[],
  win: BrowserWindow,
): Promise<{
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  toolResults: Array<{ toolCallId: string; result: unknown }>;
}> {
  const model = getModel();
  console.log('[GD Agent] Starting turn. Messages: %d', messages.length);

  // Inject current date into system prompt so GDD timestamps are accurate
  const systemPrompt = GD_SYSTEM_PROMPT.replace(
    /CURRENT_DATE/g,
    new Date().toISOString().split('T')[0],
  );

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(5),
    onChunk({ chunk }) {
      if (chunk.type === 'text-delta') {
        win.webContents.send('agent:stream', {
          type: 'text-delta',
          text: chunk.text,
        });
      } else if (chunk.type === 'tool-call') {
        console.log('[GD Agent] Tool call: %s (id: %s)', chunk.toolName, chunk.toolCallId);
        win.webContents.send('agent:stream', {
          type: 'tool-call',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input,
        });
      } else if (chunk.type === 'tool-result') {
        console.log('[GD Agent] Tool result: %s', chunk.toolCallId);
        win.webContents.send('agent:stream', {
          type: 'tool-result',
          toolCallId: chunk.toolCallId,
          result: chunk.output,
        });
      }
    },
  });

  const text = await result.text;
  const allToolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  const allToolResults: Array<{ toolCallId: string; result: unknown }> = [];

  for (const step of await result.steps) {
    for (const tc of step.toolCalls) {
      allToolCalls.push({
        id: tc.toolCallId,
        name: tc.toolName,
        args: (tc as any).input ?? (tc as any).args ?? {},
      });
    }
    for (const tr of step.toolResults) {
      allToolResults.push({
        toolCallId: tr.toolCallId,
        result: (tr as any).output ?? (tr as any).result ?? null,
      });
    }
  }

  win.webContents.send('agent:stream', { type: 'done', text });
  console.log('[GD Agent] Turn done. Text: %d chars, Tool calls: %d, Tool results: %d', text.length, allToolCalls.length, allToolResults.length);

  return { text, toolCalls: allToolCalls, toolResults: allToolResults };
}
