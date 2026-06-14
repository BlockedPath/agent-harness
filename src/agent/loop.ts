import { createTwoFilesPatch } from 'diff';
import fs from 'node:fs/promises';
import type { ChatMessage, LlmProvider } from '../llm/types.js';
import { aggregateStream } from '../llm/stream.js';
import { buildSystemPrompt } from './prompts.js';
import type { AgentEvent } from './types.js';
import type { PermissionConfig } from '../policy/types.js';
import { requiresApproval } from '../policy/approval.js';
import { appendMessage } from '../session/store.js';
import type { Session } from '../session/types.js';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import { toProviderTools } from '../tools/registry.js';
import type { ToolDefinitionFull, ToolResult } from '../tools/types.js';
import { loadWorkspaceContext } from '../workspace/context.js';

export interface RunTurnOptions {
  session: Session;
  provider: LlmProvider;
  tools: ToolDefinitionFull[];
  config: { permissions: PermissionConfig; maxIterations?: number };
  onEvent: (event: AgentEvent) => void;
  userMessage?: string;
}

export async function runTurn(options: RunTurnOptions): Promise<void> {
  if (options.userMessage) {
    const msg: ChatMessage = { role: 'user', content: options.userMessage };
    options.session.messages.push(msg);
    await appendMessage(options.session.workspaceRoot, options.session.id, msg);
  }
  const context = await loadWorkspaceContext(options.session.workspaceRoot);
  const system: ChatMessage = { role: 'system', content: buildSystemPrompt(context, options.tools) };
  const maxIterations = options.config.maxIterations ?? 25;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const stream = await options.provider.stream({ model: options.session.model, messages: [system, ...trimMessages(options.session.messages)], tools: toProviderTools(options.tools) });
    const aggregated = await aggregateStream(stream, (text) => options.onEvent({ type: 'content', text }));
    if (aggregated.usage) options.onEvent({ type: 'usage', usage: aggregated.usage });
    const assistantMessage: ChatMessage = { role: 'assistant', content: aggregated.content, toolCalls: aggregated.toolCalls.length ? aggregated.toolCalls : undefined };
    options.session.messages.push(assistantMessage);
    await appendMessage(options.session.workspaceRoot, options.session.id, assistantMessage);
    if (!aggregated.toolCalls.length) { options.onEvent({ type: 'done' }); return; }

    for (const toolCall of aggregated.toolCalls) {
      const tool = options.tools.find((candidate) => candidate.name === toolCall.function.name);
      if (!tool) {
        await pushToolResult(options, toolCall.id, { ok: false, output: '', error: `Unknown tool: ${toolCall.function.name}` });
        continue;
      }
      const parsed = tool.parameters.safeParse(parseArgs(toolCall.function.arguments));
      if (!parsed.success) {
        await pushToolResult(options, toolCall.id, { ok: false, output: '', error: parsed.error.message });
        continue;
      }
      const diff = await previewDiff(tool.name, parsed.data, options.session.workspaceRoot);
      if (requiresApproval(tool.risk, options.config.permissions)) {
        const approved = await new Promise<boolean>((resolve) => options.onEvent({ type: 'approval-request', toolCallId: toolCall.id, name: tool.name, diff, resolve }));
        if (!approved) {
          await pushToolResult(options, toolCall.id, { ok: false, output: 'User denied approval.', error: 'denied' });
          continue;
        }
      }
      options.onEvent({ type: 'tool-start', toolCallId: toolCall.id, name: tool.name, input: parsed.data });
      const result = await tool.run(parsed.data, { workspaceRoot: options.session.workspaceRoot, sessionId: options.session.id, emit: options.onEvent });
      options.onEvent({ type: 'tool-done', toolCallId: toolCall.id, result });
      await pushToolResult(options, toolCall.id, result);
    }
  }
  options.onEvent({ type: 'error', message: 'Agent iteration limit reached.' });
}

function parseArgs(raw: string): unknown { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
function trimMessages(messages: ChatMessage[]): ChatMessage[] { return messages.slice(-40).map((message) => message.role === 'tool' && message.content.length > 4000 ? { ...message, content: `${message.content.slice(0, 4000)}\n[trimmed]` } : message); }
async function pushToolResult(options: RunTurnOptions, toolCallId: string, result: ToolResult): Promise<void> { const message: ChatMessage = { role: 'tool', toolCallId, content: result.ok ? result.output : `${result.error ?? 'error'}\n${result.output}` }; options.session.messages.push(message); await appendMessage(options.session.workspaceRoot, options.session.id, message); }

async function previewDiff(toolName: string, input: unknown, workspaceRoot: string): Promise<string | undefined> {
  const data = input as { path: string; oldString: string; newString: string; content?: string; patch: string };
  try {
    if (toolName === 'replace_string') {
      const abs = resolveWorkspacePath(workspaceRoot, data.path);
      const oldContent = await fs.readFile(abs, 'utf8');
      return createTwoFilesPatch(data.path, data.path, oldContent, oldContent.replace(data.oldString, data.newString));
    }
    if (toolName === 'create_file') return createTwoFilesPatch('/dev/null', data.path, '', data.content ?? '');
    if (toolName === 'delete_file') { const abs = resolveWorkspacePath(workspaceRoot, data.path); return createTwoFilesPatch(data.path, '/dev/null', await fs.readFile(abs, 'utf8'), ''); }
    if (toolName === 'apply_patch') return data.patch;
  } catch { return undefined; }
  return undefined;
}
