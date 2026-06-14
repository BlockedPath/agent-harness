import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage } from '../llm/types.js';
import type { Session, SessionEvent } from './types.js';

export async function createSession(workspaceRoot: string, providerId: string, model: string): Promise<Session> {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  const session: Session = { id, workspaceRoot, providerId, model, messages: [], createdAt: new Date().toISOString() };
  await appendEvent(workspaceRoot, id, { type: 'session-created', data: { id, workspaceRoot, providerId, model, createdAt: session.createdAt } });
  return session;
}

export async function appendEvent(workspaceRoot: string, sessionId: string, event: SessionEvent): Promise<void> {
  const dir = sessionDir(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  await fs.appendFile(file, `${JSON.stringify(event)}\n`);
}

export async function appendMessage(workspaceRoot: string, sessionId: string, message: ChatMessage): Promise<void> {
  await appendEvent(workspaceRoot, sessionId, { type: 'message', data: message });
}

export async function setSessionModel(workspaceRoot: string, sessionId: string, model: string): Promise<void> {
  await appendEvent(workspaceRoot, sessionId, { type: 'model-changed', data: { model } });
}

export async function loadSession(workspaceRoot: string, sessionId: string): Promise<Session> {
  const raw = await fs.readFile(path.join(sessionDir(workspaceRoot), `${sessionId}.jsonl`), 'utf8');
  let session: Session | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as SessionEvent;
    if (event.type === 'session-created') session = { ...event.data, messages: [] };
    if (event.type === 'message') {
      if (!session) throw new Error(`Session ${sessionId} is missing creation event.`);
      session.messages.push(event.data);
    }
    if (event.type === 'model-changed') {
      if (!session) throw new Error(`Session ${sessionId} is missing creation event.`);
      session.model = event.data.model;
    }
  }
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

export async function listSessions(workspaceRoot: string): Promise<string[]> {
  try {
    const dir = sessionDir(workspaceRoot);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const stats = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl')).map(async (entry) => ({ name: entry.name.replace(/\.jsonl$/, ''), stat: await fs.stat(path.join(dir, entry.name)) })));
    return stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).map((entry) => entry.name);
  } catch { return []; }
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  model: string;
  messageCount: number;
  preview: string;
}

export async function listSessionSummaries(workspaceRoot: string, limit = 20): Promise<SessionSummary[]> {
  const ids = (await listSessions(workspaceRoot)).slice(0, limit);
  const summaries = await Promise.all(ids.map(async (id): Promise<SessionSummary | null> => {
    try {
      const session = await loadSession(workspaceRoot, id);
      const firstUser = session.messages.find((message) => message.role === 'user');
      const preview = firstUser ? firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 60) : '(no messages)';
      return { id, createdAt: session.createdAt, model: session.model, messageCount: session.messages.length, preview };
    } catch {
      return null;
    }
  }));
  return summaries.filter((summary): summary is SessionSummary => summary !== null);
}

function sessionDir(workspaceRoot: string): string { return path.join(workspaceRoot, '.harness', 'sessions'); }
