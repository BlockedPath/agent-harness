import type { ToolResult } from '../tools/types.js';

export type AgentEvent =
  | { type: 'content'; text: string }
  // Emitted as a tool call streams in, before it is executed. `name` and
  // `partialArgs` are cumulative (the full text seen so far for this call), so
  // consumers replace rather than append. `toolCallId` matches the later
  // tool-start/tool-done for the same call. `name` may be empty until the
  // provider has sent it.
  | { type: 'tool-call-delta'; toolCallId: string; name: string; partialArgs: string }
  | { type: 'tool-start'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool-done'; toolCallId: string; result: ToolResult }
  | { type: 'approval-request'; toolCallId: string; name: string; diff?: string; resolve: (approved: boolean) => void }
  | { type: 'question'; question: string; resolve: (answer: string) => void }
  | { type: 'usage'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'compaction'; droppedCount: number; keptCount: number }
  | { type: 'error'; message: string }
  | { type: 'done' };
