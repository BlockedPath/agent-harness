import type { LlmProvider } from './types.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { CodexOAuthProvider, loadCodexCredentials, type CodexCredentials } from './providers/codex-oauth.js';
import { OpenAiProvider } from './providers/openai.js';

type ProviderAuth = 'api-key' | 'codex-oauth';

interface ProviderConfig {
  apiKeyEnv?: string;
  baseUrl?: string;
  auth?: ProviderAuth;
  oauthTokenEnv?: string;
  oauthCredentialsPath?: string;
  oauthSourceCredentialsPath?: string;
}

export interface ProviderRegistryConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
}

export type ProviderCredentialStatus =
  | { ok: true; providerId: string; auth: ProviderAuth }
  | { ok: false; providerId: string; auth?: ProviderAuth; reason: 'unknown-provider' | 'missing-config' | 'missing-credentials'; action: 'login' | 'set-env' | 'fix-config'; message: string; envVar?: string; credentialsPath?: string; sourceCredentialsPath?: string };

type ProviderCredentialResolution =
  | { ok: true; providerId: string; auth: 'codex-oauth'; providerConfig: ProviderConfig; credentials: CodexCredentials; status: Extract<ProviderCredentialStatus, { ok: true }> }
  | { ok: true; providerId: string; auth: 'api-key'; providerConfig: ProviderConfig; apiKey: string; status: Extract<ProviderCredentialStatus, { ok: true }> }
  | { ok: false; status: Extract<ProviderCredentialStatus, { ok: false }> };

export async function getProviderCredentialStatus(config: ProviderRegistryConfig, providerId = config.defaultProvider): Promise<ProviderCredentialStatus> {
  return (await resolveProviderCredentials(config, providerId)).status;
}

export async function createProvider(config: ProviderRegistryConfig): Promise<LlmProvider> {
  const resolution = await resolveProviderCredentials(config);
  if (!resolution.ok) throw new Error(resolution.status.message);

  if (resolution.auth === 'codex-oauth') {
    return new CodexOAuthProvider({ ...resolution.credentials, baseUrl: resolution.providerConfig.baseUrl });
  }

  if (resolution.providerId === 'openai') return new OpenAiProvider({ apiKey: resolution.apiKey, baseUrl: resolution.providerConfig.baseUrl });
  if (resolution.providerId === 'anthropic') return new AnthropicProvider({ apiKey: resolution.apiKey, baseUrl: resolution.providerConfig.baseUrl });
  throw new Error(`Provider adapter not implemented: ${resolution.providerId}`);
}

async function resolveProviderCredentials(config: ProviderRegistryConfig, providerId = config.defaultProvider): Promise<ProviderCredentialResolution> {
  const providerConfig = config.providers[providerId];
  if (!providerConfig) {
    return { ok: false, status: { ok: false, providerId, reason: 'unknown-provider', action: 'fix-config', message: `Unknown provider: ${providerId}` } };
  }

  const auth = providerAuth(providerId, providerConfig);
  if (auth === 'codex-oauth') {
    const credentials = await loadCodexCredentials({
      tokenEnv: providerConfig.oauthTokenEnv,
      credentialsPath: providerConfig.oauthCredentialsPath,
      sourceCredentialsPath: providerConfig.oauthSourceCredentialsPath,
    });
    if (!credentials) {
      const envVar = providerConfig.oauthTokenEnv ?? 'CODEX_ACCESS_TOKEN';
      return {
        ok: false,
        status: {
          ok: false,
          providerId,
          auth,
          reason: 'missing-credentials',
          action: 'login',
          message: `Missing Codex OAuth credentials. Run Codex login first, or set ${envVar}.`,
          envVar,
          credentialsPath: providerConfig.oauthCredentialsPath,
          sourceCredentialsPath: providerConfig.oauthSourceCredentialsPath,
        },
      };
    }
    return { ok: true, providerId, auth, providerConfig, credentials, status: { ok: true, providerId, auth } };
  }

  if (!providerConfig.apiKeyEnv) {
    return {
      ok: false,
      status: { ok: false, providerId, auth, reason: 'missing-config', action: 'fix-config', message: `Provider ${providerId} requires apiKeyEnv in config.` },
    };
  }
  const apiKey = process.env[providerConfig.apiKeyEnv];
  if (!apiKey) {
    return {
      ok: false,
      status: { ok: false, providerId, auth, reason: 'missing-credentials', action: 'set-env', message: `Missing API key env var: ${providerConfig.apiKeyEnv}`, envVar: providerConfig.apiKeyEnv },
    };
  }
  return { ok: true, providerId, auth, providerConfig, apiKey, status: { ok: true, providerId, auth } };
}

function providerAuth(providerId: string, providerConfig: ProviderConfig): ProviderAuth {
  return providerId === 'codex' || providerConfig.auth === 'codex-oauth' ? 'codex-oauth' : 'api-key';
}
