import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { StatusFooter } from './status-footer.js';

describe('StatusFooter render', () => {
  it('shows the ready status and provider/model', () => {
    const { lastFrame } = render(<StatusFooter status="ready" providerId="codex" model="gpt-5.5" usage={null} />);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('ready');
    expect(frame).toContain('codex/gpt-5.5');
  });

  it('shows the working status', () => {
    const { lastFrame } = render(<StatusFooter status="working…" providerId="codex" model="gpt-5.5" usage={null} />);

    expect(lastFrame() ?? '').toContain('working…');
  });

  it('formats token usage in thousands', () => {
    const { lastFrame } = render(<StatusFooter status="ready" providerId="codex" model="gpt-5.5" usage={{ totalTokens: 1234 }} />);

    expect(lastFrame() ?? '').toContain('· 1.2k tok');
  });

  it('omits token usage when usage is null', () => {
    const { lastFrame } = render(<StatusFooter status="ready" providerId="codex" model="gpt-5.5" usage={null} />);

    expect(lastFrame() ?? '').not.toContain('tok');
  });
});
