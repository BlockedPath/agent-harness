import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Config } from '../config/schema.js';
import type { StreamChunk } from '../llm/types.js';
import { loadSession } from '../session/store.js';
import { runHeadless } from '../headless.js';
import { scriptedProvider } from '../test/fake-provider.js';

const baseConfig: Config = {
  defaultProvider: 'fake',
  defaultModel: 'fake-model',
  permissions: { mode: 'auto', read: 'allow', write: 'allow', execute: 'allow', network: 'ask' },
  providers: { fake: { auth: 'api-key' } },
};

async function workspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'harness-e2e-'));
}

function toolCall(id: string, name: string, args: unknown): StreamChunk {
  return { type: 'tool_call', toolCall: { id, name, arguments: JSON.stringify(args) } };
}

function finalText(text: string): StreamChunk[] {
  return [{ type: 'content', content: text }];
}

interface Sinks {
  out: string[];
  err: string[];
  write: (text: string) => void;
  writeErr: (text: string) => void;
}

function sinks(): Sinks {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, write: (t) => out.push(t), writeErr: (t) => err.push(t) };
}

describe('agent e2e (full stack via runHeadless)', () => {
  it('1. create_file: writes the file to disk and reports ok on stderr', async () => {
    const root = await workspace();
    const s = sinks();
    await runHeadless({
      workspaceRoot: root,
      config: baseConfig,
      providerId: 'fake',
      model: 'fake-model',
      prompt: 'make a file',
      provider: scriptedProvider([
        [toolCall('t1', 'create_file', { path: 'hello.txt', content: 'hi e2e' })],
        finalText('done'),
      ]),
      write: s.write,
      writeErr: s.writeErr,
    });

    const onDisk = await fs.readFile(path.join(root, 'hello.txt'), 'utf8');
    expect(onDisk).toBe('hi e2e');
    const stderr = s.err.join('');
    expect(stderr).toContain('[tool] create_file');
    expect(stderr).toContain('ok');
  });

  it('2. read_file round-trip: reads a pre-seeded file and runs ok', async () => {
    const root = await workspace();
    await fs.writeFile(path.join(root, 'seed.txt'), 'seeded content\nline two');
    const s = sinks();
    await runHeadless({
      workspaceRoot: root,
      config: baseConfig,
      providerId: 'fake',
      model: 'fake-model',
      prompt: 'read it',
      provider: scriptedProvider([
        [toolCall('t1', 'read_file', { path: 'seed.txt' })],
        finalText('read complete'),
      ]),
      write: s.write,
      writeErr: s.writeErr,
    });

    const stderr = s.err.join('');
    expect(stderr).toContain('[tool] read_file');
    expect(stderr).toContain('ok');
    // Loop completed: final text was streamed to stdout.
    expect(s.out.join('')).toContain('read complete');
  });

  it('3. run_command echo: invokes run_command without throwing', async () => {
    const root = await workspace();
    const s = sinks();
    await runHeadless({
      workspaceRoot: root,
      config: baseConfig,
      providerId: 'fake',
      model: 'fake-model',
      prompt: 'run echo',
      provider: scriptedProvider([
        [toolCall('t1', 'run_command', { command: 'echo hello-e2e' })],
        finalText('ran'),
      ]),
      write: s.write,
      writeErr: s.writeErr,
    });

    const stderr = s.err.join('');
    // Tool was attempted. Exit/stdout assertions stay tolerant because macOS
    // routes commands through sandbox-exec, which may not be available here.
    expect(stderr).toContain('[tool] run_command');
  });

  it('4. multi-tool single turn: two create_file calls in one turn both apply', async () => {
    const root = await workspace();
    const s = sinks();
    await runHeadless({
      workspaceRoot: root,
      config: baseConfig,
      providerId: 'fake',
      model: 'fake-model',
      prompt: 'make two files',
      provider: scriptedProvider([
        [
          toolCall('a', 'create_file', { path: 'one.txt', content: 'first' }),
          toolCall('b', 'create_file', { path: 'two.txt', content: 'second' }),
        ],
        finalText('both done'),
      ]),
      write: s.write,
      writeErr: s.writeErr,
    });

    expect(await fs.readFile(path.join(root, 'one.txt'), 'utf8')).toBe('first');
    expect(await fs.readFile(path.join(root, 'two.txt'), 'utf8')).toBe('second');
  });

  it('5. session resume: a second run continues the same session in order', async () => {
    const root = await workspace();

    await runHeadless({
      workspaceRoot: root,
      config: baseConfig,
      providerId: 'fake',
      model: 'fake-model',
      prompt: 'Turn 1',
      provider: scriptedProvider([finalText('reply 1')]),
      write: () => {},
      writeErr: () => {},
    });

    const dir = path.join(root, '.harness', 'sessions');
    const [file] = await fs.readdir(dir);
    if (!file) throw new Error('expected a session file');
    const sessionId = file.replace(/\.jsonl$/, '');

    await runHeadless({
      workspaceRoot: root,
      config: baseConfig,
      providerId: 'fake',
      model: 'fake-model',
      prompt: 'Turn 2',
      sessionId,
      provider: scriptedProvider([finalText('reply 2')]),
      write: () => {},
      writeErr: () => {},
    });

    const session = await loadSession(root, sessionId);
    expect(session.messages).toEqual([
      { role: 'user', content: 'Turn 1' },
      { role: 'assistant', content: 'reply 1' },
      { role: 'user', content: 'Turn 2' },
      { role: 'assistant', content: 'reply 2' },
    ]);
  });

  it('6. approval denial: a write that needs approval is denied and not applied', async () => {
    const root = await workspace();
    const s = sinks();
    const askConfig: Config = {
      ...baseConfig,
      permissions: { mode: 'on-request', read: 'allow', write: 'ask', execute: 'ask', network: 'ask' },
    };

    await runHeadless({
      workspaceRoot: root,
      config: askConfig,
      providerId: 'fake',
      model: 'fake-model',
      prompt: 'make a file',
      autoApprove: false,
      provider: scriptedProvider([
        [toolCall('t1', 'create_file', { path: 'blocked.txt', content: 'nope' })],
        finalText('handled'),
      ]),
      write: s.write,
      writeErr: s.writeErr,
    });

    const stderr = s.err.join('');
    expect(stderr).toContain('denied');
    expect(stderr).toContain('approval');
    await expect(fs.access(path.join(root, 'blocked.txt'))).rejects.toThrow();
  });
});
