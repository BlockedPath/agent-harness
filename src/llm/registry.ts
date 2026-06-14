import type { LlmProvider } from './types.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { CodexOAuthProvider, loadCodexCredentials } from './providers/codex-oauth.js';
import { OpenAiProvider } from './providers/openai.js';

export interface ProviderRegistryConfig {
  defaultProvider: string;
  providers: Record<string, { apiKeyEnv?: string; baseUrl?: string; auth?: 'api-key' | 'codex-oauth'; oauthTokenEnv?: string; oauthCredentialsPath?: string; oauthSourceCredentialsPath?: string }>;
}

export async function createProvider(config: ProviderRegistryConfig): Promise<LlmProvider> {
  const providerConfig = config.providers[config.defaultProvider];
  if (!providerConfig) throw new Error(`Unknown provider: ${config.defaultProvider}`);

  if (config.defaultProvider === 'codex' || providerConfig.auth === 'codex-oauth') {
    const credentials = await loadCodexCredentials({
      tokenEnv: providerConfig.oauthTokenEnv,
      credentialsPath: providerConfig.oauthCredentialsPath,
      sourceCredentialsPath: providerConfig.oauthSourceCredentialsPath,
    });
    if (!credentials) throw new Error(`Missing Codex OAuth credentials. Run Codex login first, or set ${providerConfig.oauthTokenEnv ?? 'CODEX_ACCESS_TOKEN'}.`);
    return new CodexOAuthProvider({ ...credentials, baseUrl: providerConfig.baseUrl });
  }

  if (!providerConfig.apiKeyEnv) throw new Error(`Provider ${config.defaultProvider} requires apiKeyEnv in config.`);
  const apiKey = process.env[providerConfig.apiKeyEnv];
  if (!apiKey) throw new Error(`Missing API key env var: ${providerConfig.apiKeyEnv}`);
  if (config.defaultProvider === 'openai') return new OpenAiProvider({ apiKey, baseUrl: providerConfig.baseUrl });
  if (config.defaultProvider === 'anthropic') return new AnthropicProvider({ apiKey, baseUrl: providerConfig.baseUrl });
  throw new Error(`Provider adapter not implemented: ${config.defaultProvider}`);
}
