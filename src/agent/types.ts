import type { ToolResult } from '../tools/types.js';

export type AgentEvent =
  | { type: 'content'; text: string }
  | { type: 'tool-start'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool-done'; toolCallId: string; result: ToolResult }
  | { type: 'approval-request'; toolCallId: string; name: string; diff?: string; resolve: (approved: boolean) => void }
  | { type: 'question'; question: string; resolve: (answer: string) => void }
  | { type: 'usage'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'compaction'; droppedCount: number; keptCount: number }
  | { type: 'error'; message: string }
  | { type: 'done' };
