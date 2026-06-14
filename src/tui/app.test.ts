import { describe, expect, it } from 'vitest';
import { CodexAuthError } from '../llm/providers/codex-oauth.js';
import { isAuthError } from './app.js';

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
