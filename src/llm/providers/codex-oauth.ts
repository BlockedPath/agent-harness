import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ChatMessage, LlmProvider, StreamChunk, ToolDefinition } from '../types.js';

const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

export interface CodexOAuthOptions {
  accessToken: string;
  accountId?: string;
  baseUrl?: string;
}

export class CodexAuthError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, options: { status: number; code?: string }) {
    super(message);
    this.name = 'CodexAuthError';
    this.status = options.status;
    this.code = options.code;
  }
}

export class CodexOAuthProvider implements LlmProvider {
  id = 'codex';
  name = 'Codex OAuth';
  private accessToken: string;
  private accountId?: string;
  private baseUrl: string;

  constructor(options: CodexOAuthOptions) {
    this.accessToken = options.accessToken;
    this.accountId = options.accountId;
    this.baseUrl = options.baseUrl ?? DEFAULT_CODEX_BASE_URL;
  }

  async stream(options: { model: string; messages: ChatMessage[]; tools: ToolDefinition[]; temperature?: number; maxTokens?: number }): Promise<AsyncIterable<StreamChunk>> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'OpenAI-Beta': 'responses=experimental',
        ...(this.accountId ? { 'ChatGPT-Account-ID': this.accountId } : {}),
      },
      body: JSON.stringify({
        model: normalizeCodexModel(options.model),
        instructions: readInstructions(options.messages),
        input: options.messages.filter((message) => message.role !== 'system').flatMap(toResponsesInput),
        tools: options.tools.map(toResponsesTool),
        temperature: options.temperature,
        stream: true,
        store: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw buildCodexHttpError(response.status, response.statusText, body);
    }
    if (!response.body) throw new Error('Codex Responses API returned no stream body.');

    return parseResponsesStream(response.body);
  }
}

export interface CodexCredentials {
  accessToken: string;
  accountId?: string;
}

export async function loadCodexAccessToken(options: { tokenEnv?: string; credentialsPath?: string; sourceCredentialsPath?: string }): Promise<string | null> {
  return (await loadCodexCredentials(options))?.accessToken ?? null;
}

export async function loadCodexCredentials(options: { tokenEnv?: string; credentialsPath?: string; sourceCredentialsPath?: string }): Promise<CodexCredentials | null> {
  if (options.tokenEnv && process.env[options.tokenEnv]) return { accessToken: process.env[options.tokenEnv] as string };
  const primary = options.credentialsPath ? await readCredentialFile(expandHome(options.credentialsPath)) : null;
  const source = options.sourceCredentialsPath ? await readCredentialFile(expandHome(options.sourceCredentialsPath)) : null;

  const selected = selectCredentialFile(primary, source);
  if (selected === source && source?.rawText && options.credentialsPath) await syncCredentialFile(source.rawText, expandHome(options.credentialsPath));
  return selected?.credentials ?? null;
}

interface CredentialFile {
  rawText: string;
  credentials: CodexCredentials;
  lastRefresh: number;
}

async function readCredentialFile(credentialsPath: string): Promise<CredentialFile | null> {
  try {
    const rawText = await fs.readFile(credentialsPath, 'utf8');
    const raw = JSON.parse(rawText) as Record<string, unknown>;
    const accessToken = readCodexAccessToken(raw);
    if (!accessToken) return null;
    return {
      rawText,
      credentials: { accessToken, accountId: readCodexAccountId(raw) ?? undefined },
      lastRefresh: readLastRefresh(raw),
    };
  } catch {
    return null;
  }
}

function selectCredentialFile(primary: CredentialFile | null, source: CredentialFile | null): CredentialFile | null {
  if (!primary) return source;
  if (!source) return primary;
  return source.lastRefresh > primary.lastRefresh ? source : primary;
}

async function syncCredentialFile(rawText: string, destinationPath: string): Promise<void> {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, rawText.endsWith('\n') ? rawText : `${rawText}\n`, { mode: 0o600 });
}

export function readCodexAccessToken(raw: Record<string, unknown>): string | null {
  const tokens = isRecord(raw.tokens) ? raw.tokens : {};
  return firstString(raw.access_token, raw.accessToken, raw.token, tokens.access_token, tokens.accessToken, tokens.token);
}

export function readCodexAccountId(raw: Record<string, unknown>): string | null {
  const tokens = isRecord(raw.tokens) ? raw.tokens : {};
  return firstString(raw.account_id, raw.accountId, raw.chatgpt_account_id, tokens.account_id, tokens.accountId, tokens.chatgpt_account_id);
}

function normalizeCodexModel(model: string): string {
  return model.startsWith('openai/') ? model.slice('openai/'.length) : model;
}

function readInstructions(messages: ChatMessage[]): string {
  return messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
}

function toResponsesInput(message: ChatMessage): Record<string, unknown>[] {
  // The Responses API models tool use as standalone items, not Chat Completions
  // `tool_calls` on an assistant message: a `function_call` for each request and
  // a `function_call_output` for each result.
  if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }];
  if (message.toolCalls?.length) {
    const items: Record<string, unknown>[] = [];
    if (message.content) items.push({ role: 'assistant', content: message.content });
    for (const call of message.toolCalls) {
      if (!call.function.name) continue; // skip malformed calls the API would reject
      items.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
    return items;
  }
  return [{ role: message.role, content: message.content }];
}

function toResponsesTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters as never) as Record<string, unknown>,
  };
}

async function* parseResponsesStream(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) yield* parseSseEvent(event);
  }

  if (buffer.trim()) yield* parseSseEvent(buffer);
}

function* parseSseEvent(event: string): Iterable<StreamChunk> {
  const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
  if (!data || data === '[DONE]') return;
  const parsed = JSON.parse(data) as Record<string, unknown>;
  const type = typeof parsed.type === 'string' ? parsed.type : '';

  if (type === 'response.output_text.delta' && typeof parsed.delta === 'string') yield { type: 'content', content: parsed.delta };
  // Tool calls are emitted only from output_item.done: it carries the complete
  // call_id, name, and arguments. The incremental arguments.delta events are keyed
  // by item_id (not call_id) and omit the name, so aggregating them would produce a
  // duplicate, nameless tool call that the Responses API later rejects.
  if (type === 'response.output_item.done' && isRecord(parsed.item) && parsed.item.type === 'function_call') {
    yield { type: 'tool_call', toolCall: { id: firstString(parsed.item.call_id, parsed.item.id) ?? undefined, name: firstString(parsed.item.name) ?? undefined, arguments: firstString(parsed.item.arguments) ?? undefined } };
  }
  if (type === 'response.completed' && isRecord(parsed.response) && isRecord(parsed.response.usage)) {
    const usage = parsed.response.usage;
    const promptTokens = numberValue(usage.input_tokens);
    const completionTokens = numberValue(usage.output_tokens);
    yield { type: 'usage', usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } };
  }
  if (type === 'response.failed') throw new Error(readResponseError(parsed) ?? 'Codex Responses API request failed.');
}

function readResponseError(parsed: Record<string, unknown>): string | null {
  const response = isRecord(parsed.response) ? parsed.response : {};
  const error = isRecord(parsed.error) ? parsed.error : isRecord(response.error) ? response.error : {};
  return firstString(error.message, response.status_details, parsed.message);
}

function buildCodexHttpError(status: number, statusText: string, body: string): Error {
  const payload = readErrorPayload(body);
  if (status === 401 && (payload.code === 'token_invalidated' || payload.message.toLowerCase().includes('token has been invalidated'))) {
    return new CodexAuthError('Codex authentication token has been invalidated. Run /login to sign in again, then retry.', { status, code: payload.code });
  }
  return new Error(`${status} ${payload.message || body || statusText}`.trim());
}

function readErrorPayload(body: string): { message: string; code?: string } {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = isRecord(parsed.error) ? parsed.error : {};
    return { message: firstString(error.message, parsed.message) ?? '', code: firstString(error.code) ?? undefined };
  } catch {
    return { message: '' };
  }
}

function readLastRefresh(raw: Record<string, unknown>): number {
  const rawLastRefresh = firstString(raw.last_refresh, raw.lastRefresh);
  if (!rawLastRefresh) return 0;
  const normalized = rawLastRefresh.replace(/\.(\d{3})\d+Z$/, '.$1Z');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function expandHome(file: string): string { return file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file; }
