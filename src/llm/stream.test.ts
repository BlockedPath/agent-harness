import { describe, expect, it } from 'vitest';
import { aggregateStream, type ToolCallDelta } from './stream.js';
import type { StreamChunk } from './types.js';

describe('aggregateStream', () => {
  it('combines text and tool call deltas', async () => {
    async function* chunks(): AsyncIterable<StreamChunk> {
      yield { type: 'content', content: 'hi ' };
      yield { type: 'content', content: 'there' };
      yield { type: 'tool_call', toolCall: { id: '1', name: 'read_', arguments: '{"path"' } };
      yield { type: 'tool_call', toolCall: { id: '1', name: 'file', arguments: ':"a.ts"}' } };
      yield { type: 'usage', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } };
    }
    const result = await aggregateStream(chunks());
    expect(result.content).toBe('hi there');
    expect(result.toolCalls[0]?.function.name).toBe('read_file');
    expect(result.toolCalls[0]?.function.arguments).toBe('{"path":"a.ts"}');
    expect(result.usage?.totalTokens).toBe(3);
  });

  it('reports cumulative tool-call deltas live via onToolCall', async () => {
    async function* chunks(): AsyncIterable<StreamChunk> {
      yield { type: 'tool_call', toolCall: { id: '1', name: 'read_', arguments: '{"path"' } };
      yield { type: 'tool_call', toolCall: { id: '1', name: 'file', arguments: ':"a.ts"}' } };
    }
    const deltas: { id: string; name: string; partialArgs: string }[] = [];
    await aggregateStream(chunks(), undefined, (delta) => deltas.push({ ...delta }));
    // One delta per chunk, each carrying the cumulative name + args so far.
    expect(deltas).toEqual([
      { id: '1', name: 'read_', partialArgs: '{"path"' },
      { id: '1', name: 'read_file', partialArgs: '{"path":"a.ts"}' },
    ]);
  });

  it('propagates an error when the underlying stream throws mid-iteration', async () => {
    async function* chunks(): AsyncIterable<StreamChunk> {
      yield { type: 'tool_call', toolCall: { id: '1', name: 'read_', arguments: '{"path"' } };
      throw new Error('boom');
    }
    const deltas: ToolCallDelta[] = [];
    await expect(aggregateStream(chunks(), undefined, (d) => deltas.push({ ...d }))).rejects.toThrow('boom');
    // The live delta for the partial call still fired before the failure.
    expect(deltas).toEqual([{ id: '1', name: 'read_', partialArgs: '{"path"' }]);
  });
});
