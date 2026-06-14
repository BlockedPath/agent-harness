import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Config } from './config/schema.js';
import type { LlmProvider, StreamChunk } from './llm/types.js';
import { loadSession } from './session/store.js';
import { runHeadless } from './headless.js';

const config: Config = {
  defaultProvider: 'codex',
  defaultModel: 'gpt-5.5',
  permissions: { mode: 'on-request', read: 'allow', write: 'ask', execute: 'ask', network: 'ask' },
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
});
