import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { ToolCard } from './tool-card.js';

describe('ToolCard render', () => {
  it('shows pending string input as streaming args', () => {
    const { lastFrame } = render(<ToolCard card={{ id: 'call_1', name: 'read_file', input: '{"path"', status: 'pending' }} />);

    expect(lastFrame() ?? '').toContain('(args streaming…)');
  });

  it('shows error marker and output', () => {
    const { lastFrame } = render(<ToolCard card={{ id: 'call_1', name: 'run_command', input: { command: 'false' }, status: 'error', output: 'command failed' }} />);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('✖');
    expect(frame).toContain('command failed');
  });

  it('shows done status', () => {
    const { lastFrame } = render(<ToolCard card={{ id: 'call_1', name: 'read_file', input: { path: 'README.md' }, status: 'done', output: 'ok' }} />);

    expect(lastFrame() ?? '').toContain('[done]');
  });
});
