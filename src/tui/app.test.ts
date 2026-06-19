import { describe, expect, it } from 'vitest';
import { CodexAuthError } from '../llm/providers/codex-oauth.js';
import { buildCredentialNotice, isAuthError } from './app.js';

describe('isAuthError', () => {
  it('detects a CodexAuthError instance', () => {
    expect(isAuthError(new CodexAuthError('token invalidated', { status: 401, code: 'token_invalidated' }))).toBe(true);
  });

  it('detects auth-shaped error messages', () => {
    expect(isAuthError(new Error('Your authentication token has been invalidated.'))).toBe(true);
    expect(isAuthError(new Error('Missing Codex OAuth credentials. Run Codex login first.'))).toBe(true);
    expect(isAuthError(new Error('Please sign in again.'))).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isAuthError(new Error('429 rate limited'))).toBe(false);
    expect(isAuthError(new Error('ECONNRESET'))).toBe(false);
    expect(isAuthError('something went wrong')).toBe(false);
  });
});

describe('buildCredentialNotice', () => {
  it('opens Codex missing credentials in the login flow', () => {
    const notice = buildCredentialNotice({
      ok: false,
      providerId: 'codex',
      auth: 'codex-oauth',
      reason: 'missing-credentials',
      action: 'login',
      message: 'Missing Codex OAuth credentials.',
      envVar: 'HARNESS_TEST_CODEX_TOKEN',
    });

    expect(notice).toMatchObject({ providerId: 'codex', action: 'login', envVar: 'HARNESS_TEST_CODEX_TOKEN' });
    expect(notice?.message).toMatch(/Codex/);
    expect(notice?.message).toMatch(/sign in/i);
  });

  it('keeps API-key providers on env-var guidance instead of browser login', () => {
    const notice = buildCredentialNotice({
      ok: false,
      providerId: 'anthropic',
      auth: 'api-key',
      reason: 'missing-credentials',
      action: 'set-env',
      message: 'Missing API key env var: ANTHROPIC_API_KEY',
      envVar: 'ANTHROPIC_API_KEY',
    });

    expect(notice).toMatchObject({ providerId: 'anthropic', action: 'set-env', envVar: 'ANTHROPIC_API_KEY' });
    expect(notice?.message).toContain('ANTHROPIC_API_KEY');
    expect(notice?.message).toMatch(/Codex OAuth/);
  });

  it('does not render a notice when credentials are available', () => {
    expect(buildCredentialNotice({ ok: true, providerId: 'openai', auth: 'api-key' })).toBeNull();
  });
});
