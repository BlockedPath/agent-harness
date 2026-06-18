import { aggregateStream } from '../llm/stream.js';
import type { ChatMessage, LlmProvider } from '../llm/types.js';
import { appendCompaction } from '../session/store.js';
import type { Session } from '../session/types.js';

/** Tunables for history compaction. Mirrors `compactionSchema` in config. */
export interface CompactionConfig {
  /** Auto-compact at the start of a turn once history exceeds `messageThreshold`. */
  auto: boolean;
  /** Message count above which auto-compaction kicks in. Should exceed `keepRecent`. */
  messageThreshold: number;
  /** Number of recent messages kept verbatim; everything older is summarized. */
  keepRecent: number;
}

export const DEFAULT_COMPACTION: CompactionConfig = { auto: false, messageThreshold: 60, keepRecent: 20 };

export interface CompactionResult {
  summary: string;
  droppedCount: number;
  keptCount: number;
}

/** Marks the synthetic message that carries a compaction summary. */
export const COMPACTION_SUMMARY_PREFIX = '[Compacted summary of earlier conversation]';

const SUMMARY_SYSTEM_PROMPT = [
  'You are compacting a long coding-assistant conversation to free up the context window.',
  'Summarize the conversation so far into a concise but complete handoff note that lets the assistant continue seamlessly. Capture:',
  '- The user\'s goals and any explicit instructions or constraints.',
  '- Key decisions made and the reasoning behind them.',
  '- Files inspected or modified, with their paths and current state.',
  '- Outstanding tasks, open questions, and the next steps.',
  'Use plain prose or bullet points. Do not invent details that were not in the conversation. Output only the summary.',
].join('\n');

/**
 * Split history into the prefix to summarize (`head`) and the recent tail kept
 * verbatim (`tail`). The boundary is walked backwards past any leading
 * `role:'tool'` messages so the tail never starts on an orphaned tool result
 * (whose assistant `tool_call` would otherwise land in the summarized head) —
 * the same pairing invariant `trimMessages` protects.
 */
export function splitForCompaction(messages: ChatMessage[], keepRecent: number): { head: ChatMessage[]; tail: ChatMessage[] } {
  if (keepRecent <= 0 || messages.length <= keepRecent) return { head: [], tail: messages.slice() };
  let boundary = messages.length - keepRecent;
  while (boundary > 0 && messages[boundary]?.role === 'tool') boundary--;
  return { head: messages.slice(0, boundary), tail: messages.slice(boundary) };
}

/** Render history as a plain transcript for the summarizer prompt. */
function renderTranscript(messages: ChatMessage[]): string {
  return messages.map((message) => {
    if (message.role === 'tool') return `tool_result: ${message.content}`;
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const calls = message.toolCalls.map((call) => `${call.function.name}(${call.function.arguments})`).join(', ');
      return `assistant: ${message.content}${message.content ? '\n' : ''}[tool calls: ${calls}]`;
    }
    return `${message.role}: ${message.content}`;
  }).join('\n\n');
}

/** Ask the provider to summarize the to-be-dropped prefix into a single note. */
export async function summarizeHistory(head: ChatMessage[], provider: LlmProvider, model: string): Promise<string> {
  const stream = await provider.stream({
    model,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: `Conversation to summarize:\n\n${renderTranscript(head)}` },
    ],
    tools: [],
  });
  const aggregated = await aggregateStream(stream);
  return aggregated.content.trim();
}

/**
 * Build the post-compaction message list: a single `user` summary message
 * followed by the kept tail. The summary is always a `user` message so it is a
 * valid first turn for every provider (Anthropic requires a user-role lead); if
 * the tail itself begins with a `user` message the summary is merged into it so
 * compaction never introduces two consecutive same-role messages.
 */
export function withSummary(summary: string, tail: ChatMessage[]): ChatMessage[] {
  const lead = tail[0];
  if (lead?.role === 'user') {
    return [{ role: 'user', content: `${COMPACTION_SUMMARY_PREFIX}\n${summary}\n\n--- Recent conversation continues ---\n\n${lead.content}` }, ...tail.slice(1)];
  }
  return [{ role: 'user', content: `${COMPACTION_SUMMARY_PREFIX}\n${summary}` }, ...tail];
}

export interface CompactSessionOptions {
  session: Session;
  provider: LlmProvider;
  keepRecent: number;
  /** Persist a `compaction` event to the session log so resume replays it. Defaults to true. */
  persist?: boolean;
}

/**
 * Summarize older history in place: replaces `session.messages` with
 * `[summary, ...recentTail]` and (unless `persist` is false) records a
 * replayable `compaction` event. Returns `null` when there is nothing old
 * enough to compact.
 */
export async function compactSession(options: CompactSessionOptions): Promise<CompactionResult | null> {
  const { session, provider, keepRecent } = options;
  const { head, tail } = splitForCompaction(session.messages, keepRecent);
  if (head.length === 0) return null;
  const summary = await summarizeHistory(head, provider, session.model);
  if (!summary) return null;
  const compacted = withSummary(summary, tail);
  // droppedCount is the number of older messages folded into the summary, which is
  // exactly head.length — not the net change in array length (withSummary may add a
  // summary message, undercounting the net difference by one in the prepend case).
  const result: CompactionResult = { summary, droppedCount: head.length, keptCount: tail.length };
  // Persist before mutating in memory: appendCompaction can fail (disk full /
  // permissions) but the in-memory splice cannot. Persisting first keeps the live
  // session and the resumable log in agreement — a persist failure leaves both at
  // the pre-compaction history rather than silently diverging on the next resume.
  if (options.persist !== false) {
    await appendCompaction(session.workspaceRoot, session.id, { ...result, at: new Date().toISOString(), messages: compacted });
  }
  session.messages.splice(0, session.messages.length, ...compacted);
  return result;
}
