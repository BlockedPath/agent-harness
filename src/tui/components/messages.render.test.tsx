import { useEffect } from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { TuiStoreProvider, useTuiStore } from '../store.js';
import { Messages } from './messages.js';

async function waitForRender(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function SeededMessages() {
  const { dispatch } = useTuiStore();

  useEffect(() => {
    dispatch({ type: 'add-message', message: { role: 'user', content: 'hello agent' } });
    dispatch({ type: 'add-message', message: { role: 'assistant', content: 'hello human' } });
    dispatch({ type: 'add-error', severity: 'provider', content: 'provider failed' });
    dispatch({ type: 'content', text: 'streaming now' });
  }, [dispatch]);

  return <Messages />;
}

describe('Messages render', () => {
  it('renders chat messages, provider errors, and streaming assistant text', async () => {
    const { lastFrame } = render(<TuiStoreProvider><SeededMessages /></TuiStoreProvider>);
    await waitForRender();

    const frame = lastFrame() ?? '';
    expect(frame).toContain('user: hello agent');
    expect(frame).toContain('assistant: hello human');
    expect(frame).toContain('✖ provider error: provider failed');
    expect(frame).toContain('assistant: streaming now');
  });
});
