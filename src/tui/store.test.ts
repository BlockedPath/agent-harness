import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './store.js';

describe('tui reducer — tool-call-delta', () => {
  it('creates a pending card with name and raw partialArgs when the id is new', () => {
    const next = reducer(initialState, { type: 'tool-call-delta', id: 'call_1', name: 'bash', partialArgs: '{"comma' });
    expect(next.toolCards).toEqual([{ id: 'call_1', name: 'bash', input: '{"comma', status: 'pending' }]);
  });

  it('replaces name/input on a second delta for the same id and yields exactly one card', () => {
    const afterFirst = reducer(initialState, { type: 'tool-call-delta', id: 'call_1', name: 'bash', partialArgs: '{"comma' });
    const afterSecond = reducer(afterFirst, { type: 'tool-call-delta', id: 'call_1', name: 'bash', partialArgs: '{"command":"ls"}' });
    expect(afterSecond.toolCards).toEqual([{ id: 'call_1', name: 'bash', input: '{"command":"ls"}', status: 'pending' }]);
    expect(afterSecond.toolCards).toHaveLength(1);
  });

  it('does not downgrade status: a delta after tool-start keeps the card running', () => {
    const afterStart = reducer(initialState, { type: 'tool-start', id: 'call_1', name: 'bash', input: { command: 'ls' } });
    const afterDelta = reducer(afterStart, { type: 'tool-call-delta', id: 'call_1', name: 'bash', partialArgs: '{"command":"ls"}' });
    const card = afterDelta.toolCards[0];
    expect(afterDelta.toolCards).toHaveLength(1);
    expect(card).toMatchObject({ id: 'call_1', name: 'bash', input: { command: 'ls' }, status: 'running' });
    expect(card?.startedAt).toEqual(expect.any(Number));
  });

  it('ignores a trailing delta after completion', () => {
    const afterStart = reducer(initialState, { type: 'tool-start', id: 'call_1', name: 'bash', input: { command: 'ls' } });
    const afterDone = reducer(afterStart, { type: 'tool-done', id: 'call_1', output: 'ok', ok: true });
    const afterDelta = reducer(afterDone, { type: 'tool-call-delta', id: 'call_1', name: 'bash', partialArgs: '{"command":"pwd"}' });
    const card = afterDelta.toolCards[0];

    expect(afterDelta.toolCards).toHaveLength(1);
    expect(card).toMatchObject({ id: 'call_1', name: 'bash', input: { command: 'ls' }, status: 'done', output: 'ok' });
    expect(card?.startedAt).toBe(afterStart.toolCards[0]?.startedAt);
  });
});

describe('tui reducer — tool-start upsert', () => {
  it('upserts the same card to running after a tool-call-delta (no duplicate)', () => {
    const afterDelta = reducer(initialState, { type: 'tool-call-delta', id: 'call_1', name: 'bash', partialArgs: '{"command":"ls"}' });
    const afterStart = reducer(afterDelta, { type: 'tool-start', id: 'call_1', name: 'bash', input: { command: 'ls' } });
    const card = afterStart.toolCards[0];
    expect(afterStart.toolCards).toHaveLength(1);
    expect(card).toMatchObject({ id: 'call_1', name: 'bash', input: { command: 'ls' }, status: 'running' });
    expect(card?.startedAt).toEqual(expect.any(Number));
  });
});

describe('tui reducer — tool-done', () => {
  it('marks successful cards done and preserves startedAt', () => {
    const afterStart = reducer(initialState, { type: 'tool-start', id: 'call_1', name: 'bash', input: { command: 'ls' } });
    const afterDone = reducer(afterStart, { type: 'tool-done', id: 'call_1', output: 'ok', ok: true });
    const card = afterDone.toolCards[0];

    expect(card).toMatchObject({ id: 'call_1', name: 'bash', status: 'done', output: 'ok' });
    expect(card?.startedAt).toBe(afterStart.toolCards[0]?.startedAt);
  });

  it('marks failed cards error and preserves output', () => {
    const afterStart = reducer(initialState, { type: 'tool-start', id: 'call_1', name: 'bash', input: { command: 'ls' } });
    const afterDone = reducer(afterStart, { type: 'tool-done', id: 'call_1', output: 'boom', ok: false });

    expect(afterDone.toolCards[0]).toMatchObject({ id: 'call_1', name: 'bash', status: 'error', output: 'boom' });
  });
});

describe('tui reducer — usage', () => {
  it('accumulates token usage across turns', () => {
    const afterFirst = reducer(initialState, { type: 'usage', usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 } });
    expect(afterFirst.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });

    const afterSecond = reducer(afterFirst, { type: 'usage', usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 } });
    expect(afterSecond.usage).toEqual({ promptTokens: 150, completionTokens: 30, totalTokens: 180 });
  });

  it('clears accumulated usage on reset', () => {
    const withUsage = reducer(initialState, { type: 'usage', usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } });
    expect(reducer(withUsage, { type: 'reset' }).usage).toBeNull();
  });
});

describe('tui reducer — errors', () => {
  it('appends a typed error message', () => {
    const next = reducer(initialState, { type: 'add-error', severity: 'provider', content: 'token invalidated' });
    expect(next.messages).toEqual([{ role: 'error', severity: 'provider', content: 'token invalidated' }]);
  });

  it('clears error messages on reset', () => {
    const withError = reducer(initialState, { type: 'add-error', severity: 'tool', content: 'boom' });
    expect(reducer(withError, { type: 'reset' }).messages).toEqual([]);
  });
});
