import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Config } from './config/schema.js';
import type { LlmProvider, StreamChunk } from './llm/types.js';
import { loadSession } from './session/store.js';
import { runHeadless } from './headless.js';
import { failingStreamProvider, scriptedProvider } from './test/fake-provider.js';

const config: Config = {
  defaultProvider: 'codex',
  defaultModel: 'gpt-5.5',
  permissions: { mode: 'on-request', read: 'allow', write: 'ask', execute: 'ask', network: 'ask' },
  compaction: { auto: false, messageThreshold: 60, keepRecent: 20 },
  tools: { deny: [] },
  providers: { codex: { auth: 'codex-oauth' } },
};

function providerEmitting(chunks: StreamChunk[]): LlmProvider {
  return {
    id: 'fake',
    name: 'Fake',
    async stream() {
      return (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
    },
  };
}

async function workspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'harness-headless-'));
}

describe('runHeadless', () => {
  it('streams assistant text to stdout and trails a newline', async () => {
    const out: string[] = [];
    await runHeadless({
      workspaceRoot: await workspace(),
      config,
      providerId: 'codex',
      model: 'gpt-5.5',
      prompt: 'hi',
      provider: providerEmitting([
        { type: 'content', content: 'Hello' },
        { type: 'content', content: ' world' },
      ]),
      write: (text) => out.push(text),
      writeErr: () => {},
    });
    expect(out.join('')).toBe('Hello world\n');
  });

  it('persists the turn to a resumable session file', async () => {
    const root = await workspace();
    await runHeadless({
      workspaceRoot: root,
      config,
      providerId: 'codex',
      model: 'gpt-5.5',
      prompt: 'remember this',
      provider: providerEmitting([{ type: 'content', content: 'noted' }]),
      write: () => {},
      writeErr: () => {},
    });
    const dir = path.join(root, '.harness', 'sessions');
    const [file] = await fs.readdir(dir);
    if (!file) throw new Error('expected a session file');
    const session = await loadSession(root, file.replace(/\.jsonl$/, ''));
    expect(session.messages).toEqual([
      { role: 'user', content: 'remember this' },
      { role: 'assistant', content: 'noted' },
    ]);
  });

  it('throws when the agent reports an error', async () => {
    // Empty stream -> no content and no tool calls forever, but maxIterations
    // is configurable through runTurn; an empty stream ends the turn with done.
    // Force an error path by exhausting iterations via a tool call to a missing tool.
    const errProvider = providerEmitting([
      { type: 'tool_call', toolCall: { id: 't1', name: 'does_not_exist', arguments: '{}' } },
    ]);
    await expect(runHeadless({
      workspaceRoot: await workspace(),
      config: { ...config, permissions: { ...config.permissions, mode: 'auto' } },
      providerId: 'codex',
      model: 'gpt-5.5',
      prompt: 'go',
      provider: errProvider,
      write: () => {},
      writeErr: () => {},
    })).rejects.toThrow(/iteration limit/i);
  });

  it('announces a streaming tool call once before the tool starts', async () => {
    const err: string[] = [];
    await runHeadless({
      workspaceRoot: await workspace(),
      config: { ...config, permissions: { ...config.permissions, mode: 'auto' } },
      providerId: 'codex',
      model: 'gpt-5.5',
      prompt: 'check status',
      provider: scriptedProvider([
        [
          { type: 'tool_call', toolCall: { id: 't1', name: 'git_status', arguments: '{' } },
          { type: 'tool_call', toolCall: { id: 't1', name: '', arguments: '}' } },
        ],
        [{ type: 'content', content: 'done' }],
      ]),
      write: () => {},
      writeErr: (text) => err.push(text),
    });

    const stderr = err.join('');
    expect(stderr.match(/\[tool→\] git_status/g) ?? []).toHaveLength(1);
    expect(stderr.indexOf('[tool→] git_status')).toBeGreaterThanOrEqual(0);
    expect(stderr.indexOf('[tool] git_status')).toBeGreaterThan(stderr.indexOf('[tool→] git_status'));
  });

  it('emits a single JSON result for a successful run', async () => {
    const out: string[] = [];
    const err: string[] = [];
    await runHeadless({
      workspaceRoot: await workspace(),
      config,
      providerId: 'codex',
      model: 'gpt-5.5',
      prompt: 'hi',
      provider: scriptedProvider([[
        { type: 'content', content: 'Hello world' },
        { type: 'usage', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
      ]]),
      json: true,
      write: (text) => out.push(text),
      writeErr: (text) => err.push(text),
    });

    expect(out).toHaveLength(1);
    expect(err.join('')).toBe('');
    expect(out[0]?.endsWith('\n')).toBe(true);
    const result = JSON.parse(out[0] ?? '') as {
      ok: boolean;
      sessionId: string;
      content: string;
      toolCalls: unknown[];
      usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
      error: string | null;
    };
    expect(result.ok).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(result.content).toBe('Hello world');
    expect(result.toolCalls).toEqual([]);
    expect(result.usage?.totalTokens).toBe(3);
    expect(result.error).toBeNull();
  });

  it('includes tool call results in JSON mode', async () => {
    const root = await workspace();
    await fs.writeFile(path.join(root, 'a.txt'), 'file content for json mode\n');
    const out: string[] = [];
    await runHeadless({
      workspaceRoot: root,
      config,
      providerId: 'codex',
      model: 'gpt-5.5',
      prompt: 'read a.txt',
      provider: scriptedProvider([
        [{ type: 'tool_call', toolCall: { id: 't1', name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) } }],
        [{ type: 'content', content: 'done' }],
      ]),
      json: true,
      write: (text) => out.push(text),
      writeErr: () => {},
    });

    expect(out).toHaveLength(1);
    const result = JSON.parse(out[0] ?? '') as {
      ok: boolean;
      content: string;
      toolCalls: Array<{ name: string; input: unknown; ok: boolean | null; output: string; error: string | null }>;
      usage: unknown;
      error: string | null;
    };
    expect(result.ok).toBe(true);
    expect(result.content).toBe('done');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ name: 'read_file', ok: true, error: null });
    expect(result.toolCalls[0]?.output).toContain('file content for json mode');
    expect(result.usage).toBeNull();
    expect(result.error).toBeNull();
  });

  it('applies configured tool filtering in JSON mode', async () => {
    const out: string[] = [];
    let offeredTools: string[] = [];
    const provider: LlmProvider = {
      id: 'fake',
      name: 'Fake',
      async stream(options) {
        offeredTools = options.tools.map((tool) => tool.name);
        return (async function* () {
          yield { type: 'content', content: 'filtered' } satisfies StreamChunk;
        })();
      },
    };

    await runHeadless({
      workspaceRoot: await workspace(),
      config: { ...config, tools: { deny: ['run_command'] } },
      providerId: 'codex',
      model: 'gpt-5.5',
      prompt: 'hi',
      provider,
      json: true,
      write: (text) => out.push(text),
      writeErr: () => {},
    });

    expect(offeredTools).toContain('read_file');
    expect(offeredTools).not.toContain('run_command');
    expect(JSON.parse(out[0] ?? '')).toMatchObject({ ok: true, content: 'filtered' });
  });

  it('writes JSON before throwing on provider setup errors', async () => {
    const out: string[] = [];
    const missingEnv = 'HARNESS_HEADLESS_JSON_MISSING_API_KEY';

    await expect(runHeadless({
      workspaceRoot: await workspace(),
      config: {
        ...config,
        defaultProvider: 'missing',
        providers: { missing: { auth: 'api-key', apiKeyEnv: missingEnv } },
      },
      providerId: 'missing',
      model: 'fake-model',
      prompt: 'hi',
      json: true,
      write: (text) => out.push(text),
      writeErr: () => {},
    })).rejects.toThrow(`Missing API key env var: ${missingEnv}`);

    expect(out).toHaveLength(1);
    const result = JSON.parse(out[0] ?? '') as {
      ok: boolean;
      sessionId: string;
      content: string;
      toolCalls: unknown[];
      usage: unknown;
      error: string | null;
    };
    expect(result.ok).toBe(false);
    expect(result.sessionId).toBeTruthy();
    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toBeNull();
    expect(result.error).toBe(`Missing API key env var: ${missingEnv}`);
  });

  it('writes JSON before throwing on errors', async () => {
    const out: string[] = [];
    await expect(runHeadless({
      workspaceRoot: await workspace(),
      config,
      providerId: 'codex',
      model: 'gpt-5.5',
      prompt: 'go',
      provider: failingStreamProvider([], 'stream aborted'),
      json: true,
      write: (text) => out.push(text),
      writeErr: () => {},
    })).rejects.toThrow('stream aborted');

    expect(out).toHaveLength(1);
    const result = JSON.parse(out[0] ?? '') as {
      ok: boolean;
      content: string;
      toolCalls: unknown[];
      usage: unknown;
      error: string | null;
    };
    expect(result.ok).toBe(false);
    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([]);
    expect(result.usage).toBeNull();
    expect(result.error).toBe('stream aborted');
  });
});
