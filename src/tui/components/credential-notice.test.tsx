import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { CredentialNoticePanel } from './credential-notice.js';

describe('CredentialNoticePanel', () => {
  it('renders API-key setup guidance without offering browser login', () => {
    const output = renderToString(
      <CredentialNoticePanel
        notice={{
          providerId: 'anthropic',
          action: 'set-env',
          envVar: 'ANTHROPIC_API_KEY',
          message: 'Missing API key env var: ANTHROPIC_API_KEY. Browser login is only available for Codex OAuth.',
        }}
        onCancel={() => {}}
        onLogin={() => {}}
      />,
    );

    expect(output).toContain('Authentication required');
    expect(output).toContain('ANTHROPIC_API_KEY');
    expect(output).toContain('export ANTHROPIC_API_KEY=...');
    expect(output).not.toContain('Press Enter to sign in');
  });

  it('renders Codex login as the keyboard primary action', () => {
    const output = renderToString(
      <CredentialNoticePanel
        notice={{ providerId: 'codex', action: 'login', envVar: 'CODEX_ACCESS_TOKEN', message: 'Codex is selected, but no OAuth credentials were found.' }}
        onCancel={() => {}}
        onLogin={() => {}}
      />,
    );

    expect(output).toContain('Authentication required');
    expect(output).toContain('Codex is selected');
    expect(output).toContain('Press Enter to sign in with Codex');
  });
});
