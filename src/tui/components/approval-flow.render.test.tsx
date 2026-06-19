import { useEffect } from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { TuiStoreProvider, useTuiStore } from '../store.js';
import { ApprovalModal } from './approval-modal.js';
import { InputBar } from './input-bar.js';

async function waitForRender(): Promise<void> {
  for (let tick = 0; tick < 2; tick += 1) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  }
}

function ApprovalHarness({ resolve }: { resolve: (approved: boolean) => void }) {
  const { dispatch } = useTuiStore();

  useEffect(() => {
    dispatch({ type: 'approval', request: { toolCallId: 'a1', name: 'run_command', resolve } });
  }, [dispatch, resolve]);

  return (
    <>
      <ApprovalModal />
      <InputBar onSubmit={() => undefined} />
    </>
  );
}

describe('approval flow render', () => {
  it('approves with y and clears the modal', async () => {
    const resolve = vi.fn();
    const { lastFrame, stdin } = render(<TuiStoreProvider><ApprovalHarness resolve={resolve} /></TuiStoreProvider>);
    await waitForRender();

    expect(lastFrame() ?? '').toContain('Allow run_command? [y]es [n]o');

    stdin.write('y');
    await waitForRender();

    expect(resolve).toHaveBeenCalledWith(true);
    expect(lastFrame() ?? '').not.toContain('Allow run_command');
  });

  it('rejects with n and clears the modal', async () => {
    const resolve = vi.fn();
    const { lastFrame, stdin } = render(<TuiStoreProvider><ApprovalHarness resolve={resolve} /></TuiStoreProvider>);
    await waitForRender();

    expect(lastFrame() ?? '').toContain('Allow run_command? [y]es [n]o');

    stdin.write('n');
    await waitForRender();

    expect(resolve).toHaveBeenCalledWith(false);
    expect(lastFrame() ?? '').not.toContain('Allow run_command');
  });
});
