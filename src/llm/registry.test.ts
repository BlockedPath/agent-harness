import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider, getProviderCredentialStatus, type ProviderRegistryConfig } from './registry.js';

const CODEX_ENV = 'HARNESS_TEST_CODEX_TOKEN';
const OPENAI_ENV = 'HARNESS_TEST_OPENAI_KEY';
const ANTHROPIC_ENV = 'HARNESS_TEST_ANTHROPIC_KEY';

function config(defaultProvider: string, providers: ProviderRegistryConfig['providers']): ProviderRegistryConfig {
  return { defaultProvider, providers };
}

describe('provider credential status', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('routes missing Codex OAuth credentials to browser login', async () => {
    vi.stubEnv(CODEX_ENV, '');

    const status = await getProviderCredentialStatus(config('codex', { codex: { auth: 'codex-oauth', oauthTokenEnv: CODEX_ENV } }));

    if (status.ok) throw new Error('expected missing Codex credentials');
    expect(status).toMatchObject({ ok: false, providerId: 'codex', auth: 'codex-oauth', reason: 'missing-credentials', action: 'login', envVar: CODEX_ENV });
    expect(status.message).toMatch(/Codex OAuth credentials/);
  });

  it('accepts Codex credentials from the token environment', async () => {
    vi.stubEnv(CODEX_ENV, 'codex-token');

    const provider = await createProvider(config('codex', { codex: { auth: 'codex-oauth', oauthTokenEnv: CODEX_ENV } }));
    const status = await getProviderCredentialStatus(config('codex', { codex: { auth: 'codex-oauth', oauthTokenEnv: CODEX_ENV } }));

    expect(provider.id).toBe('codex');
    expect(status).toEqual({ ok: true, providerId: 'codex', auth: 'codex-oauth' });
  });

  it('points API-key providers at their missing environment variable, not Codex login', async () => {
    vi.stubEnv(OPENAI_ENV, '');

    const status = await getProviderCredentialStatus(config('openai', { openai: { auth: 'api-key', apiKeyEnv: OPENAI_ENV } }));

    if (status.ok) throw new Error('expected missing API key');
    expect(status).toMatchObject({ ok: false, providerId: 'openai', auth: 'api-key', reason: 'missing-credentials', action: 'set-env', envVar: OPENAI_ENV });
    expect(status.message).toContain(OPENAI_ENV);
  });

  it('reports missing apiKeyEnv as a provider configuration error', async () => {
    const status = await getProviderCredentialStatus(config('openai', { openai: { auth: 'api-key' } }));

    expect(status).toEqual({ ok: false, providerId: 'openai', auth: 'api-key', reason: 'missing-config', action: 'fix-config', message: 'Provider openai requires apiKeyEnv in config.' });
    await expect(createProvider(config('openai', { openai: { auth: 'api-key' } }))).rejects.toThrow(/requires apiKeyEnv/);
  });

  it('creates OpenAI and Anthropic providers from API key env vars', async () => {
    vi.stubEnv(OPENAI_ENV, 'openai-key');
    vi.stubEnv(ANTHROPIC_ENV, 'anthropic-key');

    await expect(createProvider(config('openai', { openai: { auth: 'api-key', apiKeyEnv: OPENAI_ENV } }))).resolves.toMatchObject({ id: 'openai' });
    await expect(createProvider(config('anthropic', { anthropic: { auth: 'api-key', apiKeyEnv: ANTHROPIC_ENV } }))).resolves.toMatchObject({ id: 'anthropic' });
  });

  it('keeps provider adapter errors separate from credential availability', async () => {
    vi.stubEnv('HARNESS_TEST_LOCAL_KEY', 'local-key');

    const status = await getProviderCredentialStatus(config('local', { local: { auth: 'api-key', apiKeyEnv: 'HARNESS_TEST_LOCAL_KEY' } }));

    expect(status).toEqual({ ok: true, providerId: 'local', auth: 'api-key' });
    await expect(createProvider(config('local', { local: { auth: 'api-key', apiKeyEnv: 'HARNESS_TEST_LOCAL_KEY' } }))).rejects.toThrow(/Provider adapter not implemented: local/);
  });

  it('reports unknown active providers before credential checks', async () => {
    const status = await getProviderCredentialStatus(config('missing', {}));

    expect(status).toEqual({ ok: false, providerId: 'missing', reason: 'unknown-provider', action: 'fix-config', message: 'Unknown provider: missing' });
    await expect(createProvider(config('missing', {}))).rejects.toThrow(/Unknown provider: missing/);
  });
});
