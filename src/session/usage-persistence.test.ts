import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTurn } from '../agent/loop.js';
import type { PermissionConfig } from '../policy/types.js';
import { scriptedProvider } from '../test/fake-provider.js';
import { appendUsage, createSession, loadSession } from './store.js';

const autoPerms: PermissionConfig = { mode: 'auto', read: 'allow', write: 'allow', execute: 'allow', network: 'allow' };

describe('usage persistence', () => {
  it('accumulates appended usage events when loading a session', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-usage-'));
    const session = await createSession(workspaceRoot, 'codex', 'gpt-5.5');

    await appendUsage(workspaceRoot, session.id, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    await appendUsage(workspaceRoot, session.id, { promptTokens: 20, completionTokens: 10, totalTokens: 30 });

    const loaded = await loadSession(workspaceRoot, session.id);
    expect(loaded.usage).toEqual({ promptTokens: 30, completionTokens: 15, totalTokens: 45 });
  });

  it('defaults old sessions without usage to zero before accumulating usage events', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-usage-'));
    const sessionId = 'old-session';
    const sessionsDir = path.join(workspaceRoot, '.harness', 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(path.join(sessionsDir, `${sessionId}.jsonl`), `${JSON.stringify({
      type: 'session-created',
      data: { id: sessionId, workspaceRoot, providerId: 'codex', model: 'gpt-5.5', createdAt: '2026-06-19T00:00:00.000Z' },
    })}\n`);
    await appendUsage(workspaceRoot, sessionId, { promptTokens: 3, completionTokens: 4, totalTokens: 7 });

    const loaded = await loadSession(workspaceRoot, sessionId);
    expect(loaded.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
  });

  it('persists usage emitted by runTurn and restores it on load', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-usage-'));
    const session = await createSession(workspaceRoot, 'codex', 'gpt-5.5');
    const provider = scriptedProvider([[
      { type: 'content', content: 'hi' },
      { type: 'usage', usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } },
    ]]);

    await runTurn({
      session,
      provider,
      tools: [],
      config: { permissions: autoPerms },
      onEvent() {},
    });

    const loaded = await loadSession(workspaceRoot, session.id);
    expect(loaded.usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
  });
});
