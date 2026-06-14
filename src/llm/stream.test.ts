import { describe, expect, it } from 'vitest';
import { aggregateStream } from './stream.js';
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
    expect(result.toolCalls[0].function.name).toBe('read_file');
    expect(result.toolCalls[0].function.arguments).toBe('{"path":"a.ts"}');
    expect(result.usage?.totalTokens).toBe(3);
  });
});
