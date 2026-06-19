import { renderToString } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { ToolCard } from './tool-card.js';

describe('ToolCard', () => {
  it('shows a spinner and elapsed seconds while running', () => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000);

    const output = renderToString(
      <ToolCard card={{ id: 'call_1', name: 'read_file', input: { path: 'README.md' }, status: 'running', startedAt: 1_000 }} />,
    );

    expect(output).toContain('⠋ tool read_file [running] 3s');
    vi.useRealTimers();
  });

  it('omits spinner and elapsed seconds after completion', () => {
    const output = renderToString(
      <ToolCard card={{ id: 'call_1', name: 'read_file', input: { path: 'README.md' }, status: 'done', startedAt: 1_000, output: 'ok' }} />,
    );

    expect(output).toContain('tool read_file [done]');
    expect(output).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
    expect(output).not.toContain(' 3s');
  });
});
