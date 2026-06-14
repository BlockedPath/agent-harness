import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAuthError, CodexOAuthProvider, loadCodexCredentials } from './codex-oauth.js';

describe('loadCodexCredentials', () => {
  it('syncs newer source credentials over stale workspace credentials', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-codex-auth-'));
    const workspacePath = path.join(dir, 'workspace.json');
    const sourcePath = path.join(dir, 'source.json');
    await fs.writeFile(workspacePath, JSON.stringify(authFile('old-token', '2026-06-14T10:39:05.026532Z')));
    await fs.writeFile(sourcePath, JSON.stringify(authFile('new-token', '2026-06-14T10:45:30.239876Z')));

    const credentials = await loadCodexCredentials({ credentialsPath: workspacePath, sourceCredentialsPath: sourcePath });

    expect(credentials?.accessToken).toBe('new-token');
    const synced = JSON.parse(await fs.readFile(workspacePath, 'utf8')) as { tokens: { access_token: string } };
    expect(synced.tokens.access_token).toBe('new-token');
  });
});

describe('CodexOAuthProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps token invalidation responses to a helpful auth error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({
        error: {
          message: 'Your authentication token has been invalidated. Please try signing in again.',
          code: 'token_invalidated',
        },
      }),
    })));

    const provider = new CodexOAuthProvider({ accessToken: 'stale-token' });

    await expect(provider.stream({ model: 'gpt-5.5', messages: [], tools: [] })).rejects.toThrow(CodexAuthError);
    await expect(provider.stream({ model: 'gpt-5.5', messages: [], tools: [] })).rejects.toThrow('/login');
  });

  it('sends Codex model slugs without provider prefixes', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    }));
    vi.stubGlobal('fetch', fetch);

    const provider = new CodexOAuthProvider({ accessToken: 'token' });
    await provider.stream({ model: 'openai/gpt-5.5', messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }], tools: [], maxTokens: 20 });

    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { model: string; instructions: string; input: Array<{ role: string }>; max_output_tokens?: number };
    expect(body.model).toBe('gpt-5.5');
    expect(body.instructions).toBe('Be brief.');
    expect(body.input).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(body.max_output_tokens).toBeUndefined();
  });

  it('serializes tool calls and results as Responses API items, not chat tool_calls', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
    }));
    vi.stubGlobal('fetch', fetch);

    const provider = new CodexOAuthProvider({ accessToken: 'token' });
    await provider.stream({
      model: 'gpt-5.5',
      tools: [],
      messages: [
        { role: 'user', content: 'list files' },
        { role: 'assistant', content: 'on it', toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'list_files', arguments: '{"path":"."}' } }] },
        { role: 'tool', toolCallId: 'call_1', content: 'a.ts\nb.ts' },
      ],
    });

    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { input: Array<Record<string, unknown>> };
    expect(body.input).toEqual([
      { role: 'user', content: 'list files' },
      { role: 'assistant', content: 'on it' },
      { type: 'function_call', call_id: 'call_1', name: 'list_files', arguments: '{"path":"."}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'a.ts\nb.ts' },
    ]);
    // The Chat Completions shape that triggered "Unknown parameter: input[].tool_calls".
    expect(JSON.stringify(body.input)).not.toContain('tool_calls');
  });

  it('emits one complete tool call from output_item.done, ignoring nameless arg deltas', async () => {
    const events = [
      'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"pattern\\""}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":":\\"todo\\"}"}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"search_files","arguments":"{\\"pattern\\":\\"todo\\"}"}}\n\n',
    ];
    const fetch = vi.fn(async () => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) controller.enqueue(new TextEncoder().encode(event));
          controller.close();
        },
      }),
    }));
    vi.stubGlobal('fetch', fetch);

    const provider = new CodexOAuthProvider({ accessToken: 'token' });
    const stream = await provider.stream({ model: 'gpt-5.5', messages: [{ role: 'user', content: 'find todos' }], tools: [] });
    const toolCalls = [];
    for await (const chunk of stream) if (chunk.type === 'tool_call') toolCalls.push(chunk.toolCall);

    expect(toolCalls).toEqual([{ id: 'call_1', name: 'search_files', arguments: '{"pattern":"todo"}' }]);
  });
});

function authFile(accessToken: string, lastRefresh: string): Record<string, unknown> {
  return {
    auth_mode: 'chatgpt',
    last_refresh: lastRefresh,
    tokens: {
      access_token: accessToken,
      refresh_token: `${accessToken}-refresh`,
      account_id: 'account-id',
    },
  };
}
