import type { ChatMessage } from '../llm/types.js';

export interface Session {
  id: string;
  workspaceRoot: string;
  providerId: string;
  model: string;
  messages: ChatMessage[];
  createdAt: string;
}

export interface CompactionData {
  summary: string;
  droppedCount: number;
  keptCount: number;
  at: string;
  /** Full replacement message list ([summary, ...keptTail]); replayed verbatim on load. */
  messages: ChatMessage[];
}

export type SessionEvent =
  | { type: 'session-created'; data: Omit<Session, 'messages'> }
  | { type: 'message'; data: ChatMessage }
  | { type: 'model-changed'; data: { model: string } }
  | { type: 'compaction'; data: CompactionData };
