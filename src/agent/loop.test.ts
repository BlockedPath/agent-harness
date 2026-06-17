import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { trimMessages, parseArgs, previewDiff, runTurn } from './loop.js';
import { createSession } from '../session/store.js';
import { scriptedProvider } from '../test/fake-provider.js';
import type { ChatMessage } from '../llm/types.js';
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
