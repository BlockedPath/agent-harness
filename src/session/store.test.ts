import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendMessage, createSession, listSessions, listSessionSummaries, loadSession, setSessionModel } from './store.js';

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'harness-session-'));
}

describe('session store resume', () => {
  it('round-trips creation and messages through loadSession', async () => {
    const workspaceRoot = await makeWorkspace();
    const session = await createSession(workspaceRoot, 'codex', 'gpt-5.5');
    await appendMessage(workspaceRoot, session.id, { role: 'user', content: 'hello' });
    await appendMessage(workspaceRoot, session.id, { role: 'assistant', content: 'hi there' });

    const resumed = await loadSession(workspaceRoot, session.id);
    expect(resumed.id).toBe(session.id);
    expect(resumed.providerId).toBe('codex');
    expect(resumed.model).toBe('gpt-5.5');
    expect(resumed.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  it('applies the latest model-changed event on resume', async () => {
    const workspaceRoot = await makeWorkspace();
    const session = await createSession(workspaceRoot, 'codex', 'gpt-5.5');
    await appendMessage(workspaceRoot, session.id, { role: 'user', content: 'first' });
    await setSessionModel(workspaceRoot, session.id, 'gpt-5.4');
    await setSessionModel(workspaceRoot, session.id, 'gpt-5.4-mini');

    const resumed = await loadSession(workspaceRoot, session.id);
    expect(resumed.model).toBe('gpt-5.4-mini');
    expect(resumed.messages).toEqual([{ role: 'user', content: 'first' }]);
  });

  it('throws for a session that was never created', async () => {
    const workspaceRoot = await makeWorkspace();
    await expect(loadSession(workspaceRoot, 'does-not-exist')).rejects.toThrow();
  });

  it('lists sessions most-recently-modified first', async () => {
    const workspaceRoot = await makeWorkspace();
    const first = await createSession(workspaceRoot, 'codex', 'gpt-5.5');
    const second = await createSession(workspaceRoot, 'codex', 'gpt-5.5');
    // Touch the first session after the second so it becomes the newest by mtime.
    await appendMessage(workspaceRoot, first.id, { role: 'user', content: 'bump' });

    const ids = await listSessions(workspaceRoot);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
  });

  it('returns an empty list when no sessions exist', async () => {
    const workspaceRoot = await makeWorkspace();
    expect(await listSessions(workspaceRoot)).toEqual([]);
  });
});

describe('listSessionSummaries', () => {
  it('summarizes sessions with model, message count, and a preview', async () => {
    const workspaceRoot = await makeWorkspace();
    const session = await createSession(workspaceRoot, 'codex', 'gpt-5.5');
    await appendMessage(workspaceRoot, session.id, { role: 'user', content: 'fix the   login bug please' });
    await appendMessage(workspaceRoot, session.id, { role: 'assistant', content: 'on it' });

    const [summary] = await listSessionSummaries(workspaceRoot);
    expect(summary).toMatchObject({
      id: session.id,
      model: 'gpt-5.5',
      messageCount: 2,
      preview: 'fix the login bug please',
    });
  });

  it('orders newest first and respects the limit', async () => {
    const workspaceRoot = await makeWorkspace();
    const older = await createSession(workspaceRoot, 'codex', 'gpt-5.5');
    const newer = await createSession(workspaceRoot, 'codex', 'gpt-5.5');
    await appendMessage(workspaceRoot, newer.id, { role: 'user', content: 'newest' });

    const summaries = await listSessionSummaries(workspaceRoot, 1);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.id).toBe(newer.id);
    expect(summaries.map((s) => s.id)).not.toContain(older.id);
  });

  it('returns an empty list when there are no sessions', async () => {
    expect(await listSessionSummaries(await makeWorkspace())).toEqual([]);
  });
});
