import { useEffect } from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { TuiStoreProvider, useTuiStore } from '../store.js';
import { InputBar } from './input-bar.js';

function QuestionHarness({ resolve }: { resolve: (answer: string) => void }) {
  const { dispatch } = useTuiStore();
  useEffect(() => {
    dispatch({ type: 'set-disabled', disabled: true });
    dispatch({ type: 'question', question: { question: 'What should I do?', resolve } });
  }, [dispatch, resolve]);
  return <InputBar onSubmit={() => undefined} />;
}

describe('InputBar question flow', () => {
  it('accepts and submits an answer while the turn is disabled', async () => {
    const resolve = vi.fn();
    const { stdin } = render(<TuiStoreProvider><QuestionHarness resolve={resolve} /></TuiStoreProvider>);
    await new Promise<void>((done) => setTimeout(done, 10));

    stdin.write('y');
    await new Promise<void>((done) => setTimeout(done, 10));
    stdin.write('e');
    await new Promise<void>((done) => setTimeout(done, 10));
    stdin.write('s');
    await new Promise<void>((done) => setTimeout(done, 10));
    stdin.write('\r');
    await new Promise<void>((done) => setTimeout(done, 10));

    expect(resolve).toHaveBeenCalledWith('yes');
  });
});
