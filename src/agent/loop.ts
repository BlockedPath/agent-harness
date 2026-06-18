import { createTwoFilesPatch } from 'diff';
import fs from 'node:fs/promises';
import type { ChatMessage, LlmProvider } from '../llm/types.js';
import { aggregateStream } from '../llm/stream.js';
import { buildSystemPrompt } from './prompts.js';
import type { AgentEvent } from './types.js';
import type { PermissionConfig } from '../policy/types.js';
import { requiresApproval } from '../policy/approval.js';
import { classifyCommand } from '../policy/classifier.js';
import { appendMessage } from '../session/store.js';
import { compactSession, COMPACTION_SUMMARY_PREFIX, type CompactionConfig } from './compaction.js';
import type { Session } from '../session/types.js';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import { toProviderTools } from '../tools/registry.js';
import type { RiskLevel, ToolDefinitionFull, ToolResult } from '../tools/types.js';
import { loadWorkspaceContext } from '../workspace/context.js';

export interface RunTurnOptions {
  session: Session;
  provider: LlmProvider;
  tools: ToolDefinitionFull[];
  config: { permissions: PermissionConfig; maxIterations?: number; compaction?: CompactionConfig };
  onEvent: (event: AgentEvent) => void;
  userMessage?: string;
}

export async function runTurn(options: RunTurnOptions): Promise<void> {
  if (options.userMessage) {
    const msg: ChatMessage = { role: 'user', content: options.userMessage };
    options.session.messages.push(msg);
    await appendMessage(options.session.workspaceRoot, options.session.id, msg);
  }
  // Auto-compact before the turn runs, while history is in a clean state (the
  // last turn ended on assistant content, so no tool_call is left unpaired).
  // Best-effort: a failed summary must never abort the turn — fall back to the
  // full history (still bounded by trimMessages below).
  const compaction = options.config.compaction;
  if (compaction?.auto && options.session.messages.length > compaction.messageThreshold) {
    try {
      const result = await compactSession({ session: options.session, provider: options.provider, keepRecent: compaction.keepRecent });
      if (result) options.onEvent({ type: 'compaction', droppedCount: result.droppedCount, keptCount: result.keptCount });
    } catch { /* keep the uncompacted history */ }
  }

  const context = await loadWorkspaceContext(options.session.workspaceRoot);
  const system: ChatMessage = { role: 'system', content: buildSystemPrompt(context, options.tools) };
  const maxIterations = options.config.maxIterations ?? 25;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    try {
      const stream = await options.provider.stream({ model: options.session.model, messages: [system, ...trimMessages(options.session.messages)], tools: toProviderTools(options.tools) });
      const aggregated = await aggregateStream(
        stream,
        (text) => options.onEvent({ type: 'content', text }),
        (delta) => options.onEvent({ type: 'tool-call-delta', toolCallId: delta.id, name: delta.name, partialArgs: delta.partialArgs }),
      );
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
        const args = parseArgs(toolCall.function.arguments);
        if (!args.ok) {
          await pushToolResult(options, toolCall.id, { ok: false, output: '', error: 'Invalid tool arguments: not valid JSON' });
          continue;
        }
        const parsed = tool.parameters.safeParse(args.value);
        if (!parsed.success) {
          await pushToolResult(options, toolCall.id, { ok: false, output: '', error: parsed.error.message });
          continue;
        }
        const diff = await previewDiff(tool.name, parsed.data, options.session.workspaceRoot);
        const approvalRisk = riskForApproval(tool, parsed.data);
        if (requiresApproval(approvalRisk, options.config.permissions)) {
          const approved = await new Promise<boolean>((resolve) => options.onEvent({ type: 'approval-request', toolCallId: toolCall.id, name: tool.name, diff, resolve }));
          if (!approved) {
            await pushToolResult(options, toolCall.id, { ok: false, output: 'User denied approval.', error: 'denied' });
            continue;
          }
        }
        options.onEvent({ type: 'tool-start', toolCallId: toolCall.id, name: tool.name, input: parsed.data });
        let result: ToolResult;
        try {
          result = await tool.run(parsed.data, { workspaceRoot: options.session.workspaceRoot, sessionId: options.session.id, emit: options.onEvent });
        } catch (err) {
          // A thrown tool must still record a tool result, otherwise session history keeps an
          // assistant tool_call with no matching tool result — invalid for both providers on
          // resume (the dual of the orphaned-tool_result trimming bug). Convert to an error
          // result so history stays paired and the model can react to the failure.
          result = { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
        }
        options.onEvent({ type: 'tool-done', toolCallId: toolCall.id, result });
        await pushToolResult(options, toolCall.id, result);
      }
    } catch (err) {
      // A throw anywhere after the assistant message was committed can leave its
      // tool_calls unanswered. Pair every committed-but-unanswered tool_call with a
      // synthetic error result so resumed history stays provider-valid (no orphaned
      // tool_call — the dual of the trimming orphan). Best-effort: never mask the
      // original error if this itself fails.
      try { await ensureToolResultsPaired(options); } catch { /* best-effort */ }
      options.onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      options.onEvent({ type: 'done' });
      return;
    }
  }
  options.onEvent({ type: 'error', message: 'Agent iteration limit reached.' });
  options.onEvent({ type: 'done' });
}

export type ParseArgsResult = { ok: true; value: unknown } | { ok: false; error: string };
export function parseArgs(raw: string): ParseArgsResult {
  if (!raw || !raw.trim()) return { ok: true, value: {} };
  try { return { ok: true, value: JSON.parse(raw) }; } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}
export const HISTORY_WINDOW = 40;
const isCompactionSummary = (message: ChatMessage | undefined): boolean => message?.role === 'user' && message.content.startsWith(COMPACTION_SUMMARY_PREFIX);
const truncateToolContent = (message: ChatMessage): ChatMessage => message.role === 'tool' && message.content.length > 4000 ? { ...message, content: `${message.content.slice(0, 4000)}\n[trimmed ${Buffer.byteLength(message.content.slice(4000), 'utf8')} bytes]` } : message;
export function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  // A leading compaction summary must outlive the window slice: dropping it would
  // silently re-trim the context compaction just freed and, if the new head turned
  // out to be an assistant message, make the request Anthropic-invalid. Reserve a
  // slot for the summary, trim the rest, then reattach (merging into a leading user
  // message so we never emit two consecutive user turns).
  const summary = isCompactionSummary(messages[0]) ? messages[0] : undefined;
  const body = summary ? messages.slice(1) : messages;
  const window = body.slice(-(summary ? HISTORY_WINDOW - 1 : HISTORY_WINDOW));
  let start = 0;
  while (start < window.length && window[start]?.role === 'tool') start++;
  const trimmed = window.slice(start).map(truncateToolContent);
  if (!summary) return trimmed;
  if (trimmed[0]?.role === 'user') return [{ role: 'user', content: `${summary.content}\n\n--- Recent conversation continues ---\n\n${trimmed[0].content}` }, ...trimmed.slice(1)];
  return [summary, ...trimmed];
}
async function ensureToolResultsPaired(options: RunTurnOptions): Promise<void> {
  const lastAssistant = [...options.session.messages].reverse().find((m) => m.role === 'assistant' && m.toolCalls?.length);
  if (!lastAssistant?.toolCalls?.length) return;
  const answered = new Set(options.session.messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
  for (const call of lastAssistant.toolCalls) {
    if (!answered.has(call.id)) await pushToolResult(options, call.id, { ok: false, output: '', error: 'Turn aborted before tool result was produced.' });
  }
}
async function pushToolResult(options: RunTurnOptions, toolCallId: string, result: ToolResult): Promise<void> { const message: ChatMessage = { role: 'tool', toolCallId, content: result.ok ? result.output : `${result.error ?? 'error'}\n${result.output}` }; options.session.messages.push(message); await appendMessage(options.session.workspaceRoot, options.session.id, message); }
function riskForApproval(tool: ToolDefinitionFull, input: unknown): RiskLevel { return tool.name === 'run_command' ? classifyCommand((input as { command?: string }).command ?? '') : tool.risk; }
function replaceLiteralOnce(content: string, oldString: string, newString: string): string { return content.replace(oldString, () => newString); }

export async function previewDiff(toolName: string, input: unknown, workspaceRoot: string): Promise<string | undefined> {
  const data = input as { path: string; oldString: string; newString: string; content?: string; patch: string };
  try {
    if (toolName === 'replace_string') {
      const abs = resolveWorkspacePath(workspaceRoot, data.path);
      const oldContent = await fs.readFile(abs, 'utf8');
      const count = oldContent.split(data.oldString).length - 1;
      if (count !== 1) return undefined;
      return createTwoFilesPatch(data.path, data.path, oldContent, replaceLiteralOnce(oldContent, data.oldString, data.newString));
    }
    if (toolName === 'create_file') return createTwoFilesPatch('/dev/null', data.path, '', data.content ?? '');
    if (toolName === 'delete_file') { const abs = resolveWorkspacePath(workspaceRoot, data.path); return createTwoFilesPatch(data.path, '/dev/null', await fs.readFile(abs, 'utf8'), ''); }
    if (toolName === 'apply_patch') return data.patch;
  } catch { return undefined; }
  return undefined;
}
