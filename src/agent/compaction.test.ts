import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPACTION_SUMMARY_PREFIX, compactSession, splitForCompaction, withSummary } from './compaction.js';
import { appendMessage, createSession, loadSession } from '../session/store.js';
import { scriptedProvider } from '../test/fake-provider.js';
import type { ChatMessage } from '../llm/types.js';

const tmpWorkspace = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'harness-compact-'));
const summaryProvider = (text: string) => scriptedProvider([[{ type: 'content', content: text }]]);

describe('splitForCompaction', () => {
  it('keeps everything when history is at or below keepRecent', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
    expect(splitForCompaction(messages, 5)).toEqual({ head: [], tail: messages });
  });

  it('never lets the tail begin with an orphaned tool result', () => {
    // boundary (length - keepRecent) lands on a tool message whose assistant
    // tool_call would otherwise be summarized away — the tail must walk back to it.
    const messages: ChatMessage[] = [
      { role: 'user', content: 'u0' },
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', toolCallId: 't1', content: 'r1' },
      { role: 'tool', toolCallId: 't1', content: 'r2' },
      { role: 'assistant', content: 'done' },
    ];
    const { head, tail } = splitForCompaction(messages, 3);
    expect(tail[0]?.role).not.toBe('tool');
    expect(tail[0]?.role).toBe('assistant');
    expect(tail[0]?.toolCalls?.[0]?.id).toBe('t1');
    expect([...head, ...tail]).toEqual(messages); // a lossless partition
  });
});

describe('withSummary', () => {
  it('prepends a user summary when the tail starts with an assistant turn', () => {
    const tail: ChatMessage[] = [{ role: 'assistant', content: 'hi' }];
    const result = withSummary('THE SUMMARY', tail);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: `${COMPACTION_SUMMARY_PREFIX}\nTHE SUMMARY` });
    expect(result[1]).toBe(tail[0]);
  });

  it('merges into the leading user message so no two user messages are adjacent', () => {
    const tail: ChatMessage[] = [{ role: 'user', content: 'next request' }, { role: 'assistant', content: 'ok' }];
    const result = withSummary('THE SUMMARY', tail);
    expect(result).toHaveLength(2); // merged, not prepended
    expect(result[0]?.role).toBe('user');
    expect(result[0]?.content).toContain('THE SUMMARY');
    expect(result[0]?.content).toContain('next request');
    expect(result[1]?.role).toBe('assistant');
  });
});

describe('compactSession', () => {
  async function seed(workspaceRoot: string, count: number) {
    const session = await createSession(workspaceRoot, 'fake', 'fake-model');
    for (let i = 0; i < count; i++) {
      const message: ChatMessage = i % 2 === 0 ? { role: 'user', content: `u${i}` } : { role: 'assistant', content: `a${i}` };
      session.messages.push(message);
      await appendMessage(workspaceRoot, session.id, message);
    }
    return session;
  }

  it('replaces history with a summary plus the kept tail and reports the drop', async () => {
    const root = await tmpWorkspace();
    const session = await seed(root, 8);
    const result = await compactSession({ session, provider: summaryProvider('SUMMARY OF EARLIER'), keepRecent: 2 });

    expect(result).not.toBeNull();
    expect(result!.keptCount).toBe(2);
    expect(session.messages[0]?.role).toBe('user');
    expect(session.messages[0]?.content).toContain('SUMMARY OF EARLIER');
    expect(session.messages.length).toBeLessThan(8);
    expect(result!.droppedCount).toBe(8 - session.messages.length);
  });

  it('returns null when there is nothing older than keepRecent to summarize', async () => {
    const root = await tmpWorkspace();
    const session = await seed(root, 2);
    expect(await compactSession({ session, provider: summaryProvider('unused'), keepRecent: 10 })).toBeNull();
  });

  it('returns null without mutating history when the provider yields an empty summary', async () => {
    const root = await tmpWorkspace();
    const session = await seed(root, 8);
    const result = await compactSession({ session, provider: scriptedProvider([[]]), keepRecent: 2 });
    expect(result).toBeNull();
    expect(session.messages).toHaveLength(8);
  });

  it('records a replayable compaction event so resume restores the compacted history', async () => {
    const root = await tmpWorkspace();
    const session = await seed(root, 8);
    await compactSession({ session, provider: summaryProvider('REPLAYED SUMMARY'), keepRecent: 2 });

    const resumed = await loadSession(root, session.id);
    expect(resumed.messages).toEqual(session.messages);
    expect(resumed.messages[0]?.content).toContain('REPLAYED SUMMARY');
  });

  it('does not persist an event when persist is false', async () => {
    const root = await tmpWorkspace();
    const session = await seed(root, 8);
    await compactSession({ session, provider: summaryProvider('EPHEMERAL'), keepRecent: 2, persist: false });

    // Resume rebuilds from the message log alone — the in-memory compaction is not replayed.
    const resumed = await loadSession(root, session.id);
    expect(resumed.messages).toHaveLength(8);
  });
});
