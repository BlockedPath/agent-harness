import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { trimMessages, parseArgs, previewDiff, runTurn } from './loop.js';
import { COMPACTION_SUMMARY_PREFIX } from './compaction.js';
import { createSession } from '../session/store.js';
import { failingStreamProvider, scriptedProvider } from '../test/fake-provider.js';
import type { ChatMessage, LlmProvider, StreamChunk } from '../llm/types.js';
import type { AgentEvent } from './types.js';
import type { PermissionConfig } from '../policy/types.js';
import type { ToolDefinitionFull } from '../tools/types.js';

const tmpWorkspace = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'harness-loop-'));
const autoPerms: PermissionConfig = { mode: 'auto', read: 'allow', write: 'allow', execute: 'allow', network: 'allow' };

describe('trimMessages (FIX 3: orphaned tool result after trimming)', () => {
  it('drops leading orphan role:tool messages so the window never starts with role tool', () => {
    // Build > 40 messages so slice(-40) lands its head on a tool message.
    // We want the 40-slice boundary (index = length - 40) to be a tool message
    // whose preceding assistant tool_calls message was dropped.
    const messages: ChatMessage[] = [];
    // First, padding so length - 40 points at a tool message.
    // length 42 -> slice(-40) starts at index 2.
    messages.push({ role: 'user', content: 'u0' }); // index 0 (dropped)
    messages.push({ role: 'assistant', content: '', toolCalls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{}' } }] }); // index 1 (dropped -> orphans the tool below)
    messages.push({ role: 'tool', toolCallId: 't1', content: 'orphan result' }); // index 2 (head of window, orphan)
    messages.push({ role: 'tool', toolCallId: 't1', content: 'orphan result 2' }); // index 3 (also orphan)
    // Fill the rest with well-formed user/assistant pairs until total = 42.
    while (messages.length < 42) {
      messages.push({ role: 'user', content: `u${messages.length}` });
      messages.push({ role: 'assistant', content: `a${messages.length}` });
    }

    const result = trimMessages(messages);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.role).not.toBe('tool');
  });

  it('keeps a leading compaction summary that the window would otherwise drop', () => {
    const summary: ChatMessage = { role: 'user', content: `${COMPACTION_SUMMARY_PREFIX}\nearlier context` };
    const tail: ChatMessage[] = [];
    for (let i = 0; i < 45; i++) tail.push({ role: i % 2 === 0 ? 'assistant' : 'user', content: `m${i}` });
    const result = trimMessages([summary, ...tail]);
    expect(result[0]?.role).toBe('user');
    expect(result[0]?.content).toContain(COMPACTION_SUMMARY_PREFIX);
    expect(result.length).toBeLessThanOrEqual(40);
  });

  it('merges a preserved summary into a leading user turn so no two user messages are adjacent', () => {
    const summary: ChatMessage = { role: 'user', content: `${COMPACTION_SUMMARY_PREFIX}\nS` };
    const tail: ChatMessage[] = [];
    for (let i = 0; i < 45; i++) tail.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` });
    const result = trimMessages([summary, ...tail]);
    expect(result[0]?.role).toBe('user');
    expect(result[0]?.content).toContain(COMPACTION_SUMMARY_PREFIX);
    for (let i = 1; i < result.length; i++) expect(result[i - 1]?.role === 'user' && result[i]?.role === 'user').toBe(false);
  });

  it('preserves a well-formed tail (assistant followed by its tool result stays intact)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', toolCallId: 'a1', content: 'tool output' },
      { role: 'assistant', content: 'done' },
    ];
    const result = trimMessages(messages);
    expect(result).toHaveLength(4);
    expect(result[1]?.role).toBe('assistant');
    expect(result[1]?.toolCalls?.[0]?.id).toBe('a1');
    expect(result[2]?.role).toBe('tool');
    expect(result[2]?.toolCallId).toBe('a1');
  });
});

describe('parseArgs (FIX 6: surface malformed JSON)', () => {
  it("parseArgs('') -> ok with {}", () => {
    const r = parseArgs('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it("parseArgs('   ') -> ok with {}", () => {
    const r = parseArgs('   ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it('parseArgs valid JSON -> ok with parsed value', () => {
    const r = parseArgs('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  it('parseArgs malformed JSON -> NOT ok (surfaced, not coerced to {})', () => {
    const r = parseArgs('{bad json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.error).toBe('string');
  });
});

describe('runTurn (FIX 7: a thrown tool still records a tool result)', () => {
  const throwingTool: ToolDefinitionFull<Record<string, never>> = {
    name: 'boom',
    description: 'always throws',
    parameters: z.object({}),
    risk: 'read',
    async run() { throw new Error('kaboom'); },
  };

  it('converts a tool that throws into an error tool result, keeping history paired', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    const provider = scriptedProvider([
      [{ type: 'tool_call', toolCall: { id: 'b1', name: 'boom', arguments: '{}' } }],
      [{ type: 'content', content: 'after' }],
    ]);
    const events: AgentEvent[] = [];
    await runTurn({
      session,
      provider,
      tools: [throwingTool],
      config: { permissions: autoPerms },
      onEvent: (e) => events.push(e),
      userMessage: 'go',
    });

    // The assistant tool-call message must be followed by a matching tool result,
    // not left orphaned (the dual of the trim bug).
    const assistant = session.messages.find((m) => m.role === 'assistant' && m.toolCalls?.some((c) => c.id === 'b1'));
    expect(assistant).toBeDefined();
    const toolResult = session.messages.find((m) => m.role === 'tool' && m.toolCallId === 'b1');
    expect(toolResult).toBeDefined();
    expect(toolResult?.content).toContain('kaboom');
    // The throw did not abort the turn through the error channel — the loop continued and finished.
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('pairs a committed tool_call when a throw occurs outside the per-tool catch (host onEvent throws)', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    const okTool: ToolDefinitionFull<Record<string, never>> = {
      name: 'noop', description: 'no-op', parameters: z.object({}), risk: 'read',
      async run() { return { ok: true, output: 'fine' }; },
    };
    const provider = scriptedProvider([
      [{ type: 'tool_call', toolCall: { id: 'c1', name: 'noop', arguments: '{}' } }],
      [{ type: 'content', content: 'unreached' }],
    ]);
    const events: AgentEvent[] = [];
    // A misbehaving host that throws synchronously on tool-start — this throw site is
    // OUTSIDE the per-tool try/catch (it fires before tool.run), so it routes to the outer catch.
    await runTurn({
      session,
      provider,
      tools: [okTool],
      config: { permissions: autoPerms },
      onEvent: (e) => { events.push(e); if (e.type === 'tool-start') throw new Error('host blew up'); },
      userMessage: 'go',
    });

    // Even though the throw bypassed the per-tool catch, the committed tool_call c1
    // must still be paired with a synthetic tool result (no orphan on resume).
    const toolResult = session.messages.find((m) => m.role === 'tool' && m.toolCallId === 'c1');
    expect(toolResult).toBeDefined();
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });
});

describe('runTurn live tool-call deltas', () => {
  const noopTool: ToolDefinitionFull<Record<string, never>> = {
    name: 'noop', description: 'no-op', parameters: z.object({}), risk: 'read',
    async run() { return { ok: true, output: 'fine' }; },
  };

  it('emits cumulative tool-call-delta events before tool-start, sharing the toolCallId', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    // Stream the tool call across two fragments so liveness is observable.
    const provider = scriptedProvider([
      [
        { type: 'tool_call', toolCall: { id: 'd1', name: 'noop', arguments: '{' } },
        { type: 'tool_call', toolCall: { id: 'd1', name: '', arguments: '}' } },
      ],
      [{ type: 'content', content: 'after' }],
    ]);
    const events: AgentEvent[] = [];
    await runTurn({
      session,
      provider,
      tools: [noopTool],
      config: { permissions: autoPerms },
      onEvent: (e) => events.push(e),
      userMessage: 'go',
    });

    const deltas = events.filter((e) => e.type === 'tool-call-delta');
    expect(deltas).toEqual([
      { type: 'tool-call-delta', toolCallId: 'd1', name: 'noop', partialArgs: '{' },
      { type: 'tool-call-delta', toolCallId: 'd1', name: 'noop', partialArgs: '{}' },
    ]);
    // Deltas precede execution and share the id with the eventual tool-start.
    const deltaIndex = events.findIndex((e) => e.type === 'tool-call-delta');
    const startIndex = events.findIndex((e) => e.type === 'tool-start');
    expect(deltaIndex).toBeGreaterThanOrEqual(0);
    expect(startIndex).toBeGreaterThan(deltaIndex);
    const start = events[startIndex];
    expect(start?.type === 'tool-start' && start.toolCallId).toBe('d1');
  });
});

describe('runTurn stream failure mid-turn', () => {
  it('does not execute a tool or commit an assistant message when the stream throws mid-tool-call', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    let ran = false;
    const noopTool: ToolDefinitionFull<Record<string, never>> = {
      name: 'noop', description: 'no-op', parameters: z.object({}), risk: 'read',
      async run() { ran = true; return { ok: true, output: 'fine' }; },
    };
    const provider = failingStreamProvider(
      [{ type: 'tool_call', toolCall: { id: 'x1', name: 'noop', arguments: '{' } }],
      'connection reset',
    );
    const events: AgentEvent[] = [];
    await runTurn({ session, provider, tools: [noopTool], config: { permissions: autoPerms }, onEvent: (e) => events.push(e), userMessage: 'go' });

    expect(ran).toBe(false);
    expect(session.messages.some((m) => m.role === 'assistant')).toBe(false);
    expect(session.messages.some((m) => m.role === 'tool')).toBe(false);
    expect(session.messages.at(-1)).toMatchObject({ role: 'user', content: 'go' });
    // A live delta was emitted before the failure → the card the TUI must clear (Step 1).
    expect(events.some((e) => e.type === 'tool-call-delta' && e.toolCallId === 'x1')).toBe(true);
    expect(events.some((e) => e.type === 'error' && e.message.includes('connection reset'))).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('does not commit an assistant message when the stream throws after partial content', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    const provider = failingStreamProvider([{ type: 'content', content: 'partial answer' }], 'stream aborted');
    const events: AgentEvent[] = [];
    await runTurn({ session, provider, tools: [], config: { permissions: autoPerms }, onEvent: (e) => events.push(e), userMessage: 'go' });

    expect(session.messages.some((m) => m.role === 'assistant')).toBe(false);
    expect(session.messages.at(-1)).toMatchObject({ role: 'user', content: 'go' });
    expect(events.some((e) => e.type === 'content' && e.text === 'partial answer')).toBe(true);
    expect(events.some((e) => e.type === 'error' && e.message.includes('stream aborted'))).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });
});

describe('runTurn transient provider retry', () => {
  it('retries a transient failure before chunks and commits the successful retry once', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    let calls = 0;
    const provider: LlmProvider = {
      id: 'fake',
      name: 'Fake',
      async stream() {
        calls += 1;
        if (calls === 1) {
          return (async function* () {
            throw Object.assign(new Error('503'), { status: 503 });
          })();
        }
        return (async function* () {
          yield { type: 'content', content: 'ok' } as StreamChunk;
        })();
      },
    };
    const events: AgentEvent[] = [];

    await runTurn({ session, provider, tools: [], config: { permissions: autoPerms, retryBackoffMs: [0, 0, 0] }, onEvent: (e) => events.push(e), userMessage: 'go' });

    expect(calls).toBe(2);
    expect(events.filter((e) => e.type === 'content')).toEqual([{ type: 'content', text: 'ok' }]);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(session.messages.find((m) => m.role === 'assistant')).toMatchObject({ role: 'assistant', content: 'ok' });
  });

  it('does not retry a transient failure after content streamed', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    let calls = 0;
    const provider: LlmProvider = {
      id: 'fake',
      name: 'Fake',
      async stream() {
        calls += 1;
        return (async function* () {
          yield { type: 'content', content: 'partial' } as StreamChunk;
          throw new Error('connection reset');
        })();
      },
    };
    const events: AgentEvent[] = [];

    await runTurn({ session, provider, tools: [], config: { permissions: autoPerms, retryBackoffMs: [0, 0, 0] }, onEvent: (e) => events.push(e), userMessage: 'go' });

    expect(calls).toBe(1);
    expect(events.filter((e) => e.type === 'content')).toEqual([{ type: 'content', text: 'partial' }]);
    expect(session.messages.some((m) => m.role === 'assistant')).toBe(false);
    expect(events.some((e) => e.type === 'error' && e.message.includes('connection reset'))).toBe(true);
  });

  it('does not retry a transient failure after a tool delta and does not run the tool', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    let calls = 0;
    let ran = false;
    const noopTool: ToolDefinitionFull<Record<string, never>> = {
      name: 'noop', description: 'no-op', parameters: z.object({}), risk: 'read',
      async run() { ran = true; return { ok: true, output: 'fine' }; },
    };
    const provider: LlmProvider = {
      id: 'fake',
      name: 'Fake',
      async stream() {
        calls += 1;
        return (async function* () {
          yield { type: 'tool_call', toolCall: { id: 'x1', name: 'noop', arguments: '{' } } as StreamChunk;
          throw new Error('connection reset');
        })();
      },
    };
    const events: AgentEvent[] = [];

    await runTurn({ session, provider, tools: [noopTool], config: { permissions: autoPerms, retryBackoffMs: [0, 0, 0] }, onEvent: (e) => events.push(e), userMessage: 'go' });

    expect(calls).toBe(1);
    expect(ran).toBe(false);
    expect(session.messages.some((m) => m.role === 'assistant')).toBe(false);
    expect(session.messages.some((m) => m.role === 'tool')).toBe(false);
    expect(events.some((e) => e.type === 'tool-call-delta' && e.toolCallId === 'x1')).toBe(true);
    expect(events.some((e) => e.type === 'error' && e.message.includes('connection reset'))).toBe(true);
  });

  it('does not retry a non-transient status 400 error', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    let calls = 0;
    const provider: LlmProvider = {
      id: 'fake',
      name: 'Fake',
      async stream() {
        calls += 1;
        throw Object.assign(new Error('network error bad request'), { status: 400 });
      },
    };
    const events: AgentEvent[] = [];

    await runTurn({ session, provider, tools: [], config: { permissions: autoPerms, retryBackoffMs: [0, 0, 0] }, onEvent: (e) => events.push(e), userMessage: 'go' });

    expect(calls).toBe(1);
    expect(events.some((e) => e.type === 'error' && e.message.includes('network error bad request'))).toBe(true);
    expect(session.messages.some((m) => m.role === 'assistant')).toBe(false);
  });
});

describe('runTurn auto-compaction', () => {
  it('compacts older history before the turn when enabled and over threshold', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    // Pre-fill history above the threshold (the new user message pushes it over).
    for (let i = 0; i < 6; i++) session.messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` });

    // stream() call #1 is the compaction summary; call #2 is the turn itself (no tools -> done).
    const provider = scriptedProvider([
      [{ type: 'content', content: 'COMPACTED SUMMARY' }],
      [{ type: 'content', content: 'answer' }],
    ]);
    const events: AgentEvent[] = [];
    await runTurn({
      session,
      provider,
      tools: [],
      config: { permissions: autoPerms, compaction: { auto: true, messageThreshold: 5, keepRecent: 2 } },
      onEvent: (e) => events.push(e),
      userMessage: 'go',
    });

    const compactionEvent = events.find((e) => e.type === 'compaction');
    expect(compactionEvent).toBeDefined();
    expect(session.messages[0]?.content).toContain('COMPACTED SUMMARY');
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('does not abort the turn when the compaction summary call fails', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    for (let i = 0; i < 6; i++) session.messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` });
    let call = 0;
    const provider: LlmProvider = {
      id: 'fake', name: 'Fake',
      async stream() {
        call += 1;
        if (call === 1) throw new Error('summary boom'); // the compaction summary request
        return (async function* () { yield { type: 'content', content: 'answer' } as StreamChunk; })();
      },
    };
    const events: AgentEvent[] = [];
    await runTurn({
      session,
      provider,
      tools: [],
      config: { permissions: autoPerms, compaction: { auto: true, messageThreshold: 5, keepRecent: 2 } },
      onEvent: (e) => events.push(e),
      userMessage: 'go',
    });
    expect(events.some((e) => e.type === 'compaction')).toBe(false); // compaction failed silently
    expect(events.some((e) => e.type === 'done')).toBe(true); // ...but the turn still finished
    expect(session.messages.some((m) => m.content === 'm0')).toBe(true); // history was left uncompacted
  });

  it('leaves history untouched when auto-compaction is disabled', async () => {
    const root = await tmpWorkspace();
    const session = await createSession(root, 'fake', 'fake-model');
    for (let i = 0; i < 6; i++) session.messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` });
    const provider = scriptedProvider([[{ type: 'content', content: 'answer' }]]);
    const events: AgentEvent[] = [];
    await runTurn({
      session,
      provider,
      tools: [],
      config: { permissions: autoPerms, compaction: { auto: false, messageThreshold: 5, keepRecent: 2 } },
      onEvent: (e) => events.push(e),
      userMessage: 'go',
    });
    expect(events.some((e) => e.type === 'compaction')).toBe(false);
  });
});

describe('previewDiff (FIX 8: replace_string preview respects count === 1)', () => {
  it('returns undefined when oldString matches zero or multiple times', async () => {
    const root = await tmpWorkspace();
    await fs.writeFile(path.join(root, 'f.txt'), 'foo bar foo');
    expect(await previewDiff('replace_string', { path: 'f.txt', oldString: 'foo', newString: 'X' }, root)).toBeUndefined();
    expect(await previewDiff('replace_string', { path: 'f.txt', oldString: 'zzz', newString: 'X' }, root)).toBeUndefined();
  });

  it('returns a diff when oldString matches exactly once', async () => {
    const root = await tmpWorkspace();
    await fs.writeFile(path.join(root, 'f.txt'), 'foo bar baz');
    const diff = await previewDiff('replace_string', { path: 'f.txt', oldString: 'bar', newString: 'X' }, root);
    expect(diff).toBeDefined();
    expect(diff).toContain('X');
  });
});
