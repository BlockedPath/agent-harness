import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configSchema, type Config } from './schema.js';
import { DEFAULT_CODEX_MODEL } from '../llm/models.js';

const DEFAULT_CONFIG: Config = {
  defaultProvider: 'codex',
  defaultModel: DEFAULT_CODEX_MODEL,
  permissions: { mode: 'on-request', read: 'allow', write: 'ask', execute: 'ask', network: 'ask' },
  providers: {
    codex: { auth: 'codex-oauth', oauthTokenEnv: 'CODEX_ACCESS_TOKEN', oauthCredentialsPath: '.harness/auth/codex.json', oauthSourceCredentialsPath: '~/.codex/auth.json' },
    anthropic: { auth: 'api-key', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    openai: { auth: 'api-key', apiKeyEnv: 'OPENAI_API_KEY' },
  },
};

export async function loadConfig(workspaceRoot: string, explicitPath?: string): Promise<Config> {
  const user = await readJson(path.join(os.homedir(), '.config', 'harness', 'config.json'));
  const project = await readJson(path.join(workspaceRoot, '.harness', 'config.json'));
  const explicit = explicitPath ? await readJson(explicitPath) : {};
  return resolveWorkspaceAuthPaths(workspaceRoot, configSchema.parse(deepMerge(DEFAULT_CONFIG, user, project, explicit)));
}

async function readJson(file: string): Promise<Record<string, unknown>> { try { return JSON.parse(await fs.readFile(expandHome(file), 'utf8')) as Record<string, unknown>; } catch { return {}; } }
function expandHome(file: string): string { return file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file; }
function deepMerge<T extends Record<string, unknown>>(...objects: T[]): T { const result: Record<string, unknown> = {}; for (const object of objects) { for (const [key, value] of Object.entries(object)) { result[key] = isObject(result[key]) && isObject(value) ? deepMerge(result[key] as T, value as T) : value; } } return result as T; }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function resolveWorkspaceAuthPaths(workspaceRoot: string, config: Config): Config {
  const providers = Object.fromEntries(Object.entries(config.providers).map(([id, provider]) => {
    if (id !== 'codex' || !provider.oauthCredentialsPath || path.isAbsolute(provider.oauthCredentialsPath) || provider.oauthCredentialsPath.startsWith('~/')) return [id, provider];
    return [id, { ...provider, oauthCredentialsPath: path.join(workspaceRoot, provider.oauthCredentialsPath) }];
  }));
  return { ...config, providers };
}
