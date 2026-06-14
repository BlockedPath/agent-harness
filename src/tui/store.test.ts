import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './store.js';

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
