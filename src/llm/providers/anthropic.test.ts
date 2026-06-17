import type Anthropic from '@anthropic-ai/sdk';
import { describe, it, expect } from 'vitest';
import { normalizeAnthropicStream, toAnthropicMessage, coalesceToolResults } from './anthropic.js';
import { aggregateStream } from '../stream.js';
import type { ChatMessage, StreamChunk } from '../types.js';

// Synthetic SDK events are partial-by-design; cast through the real event type once here.
async function* fromEvents<T>(events: T[]): AsyncIterable<T> {
  for (const event of events) yield event;
}
const asStream = (events: unknown[]): AsyncIterable<Anthropic.MessageStreamEvent> =>
  fromEvents(events) as unknown as AsyncIterable<Anthropic.MessageStreamEvent>;

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe('normalizeAnthropicStream', () => {
  it('aggregates a tool call to the bare name with concatenated arguments and a stable id (FIX 1)', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_123', name: 'read_file' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"a.ts"}' } },
      { type: 'content_block_stop', index: 0 },
    ];

    const aggregated = await aggregateStream(normalizeAnthropicStream(asStream(events)));

    expect(aggregated.toolCalls).toHaveLength(1);
    const call = aggregated.toolCalls[0]!;
    expect(call.id).toBe('toolu_123');
    expect(call.function.name).toBe('read_file');
    expect(call.function.arguments).toBe('{"path":"a.ts"}');
  });

  it('reports real input tokens from message_start and totalTokens = input + output (FIX 3)', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 42, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
      { type: 'message_delta', delta: {}, usage: { input_tokens: null, output_tokens: 7 } },
    ];

    const aggregated = await aggregateStream(normalizeAnthropicStream(asStream(events)));

    expect(aggregated.usage).toEqual({ promptTokens: 42, completionTokens: 7, totalTokens: 49 });
  });

  it('does not re-emit the tool name on delta chunks', async () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'grep' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
    ];

    const chunks = await collect(normalizeAnthropicStream(asStream(events)));
    const deltaChunk = chunks.find((c) => c.type === 'tool_call' && c.toolCall?.arguments === '{}');
    expect(deltaChunk?.toolCall?.name).toBeUndefined();
    expect(deltaChunk?.toolCall?.id).toBe('toolu_1');
  });
});

describe('toAnthropicMessage', () => {
  it('omits the empty text block for a tool-calls-only assistant turn (FIX 2)', () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'toolu_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    };

    const result = toAnthropicMessage(message);
    const content = result.content as Anthropic.ContentBlockParam[];
    expect(content).toHaveLength(1);
    expect(content[0]?.type).toBe('tool_use');
    expect(content.some((b) => b.type === 'text')).toBe(false);
  });

  it('includes the text block when assistant content is truthy', () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: 'hi',
      toolCalls: [{ id: 'toolu_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    };

    const result = toAnthropicMessage(message);
    const content = result.content as Anthropic.ContentBlockParam[];
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'text', text: 'hi' });
    expect(content[1]?.type).toBe('tool_use');
  });
});

describe('coalesceToolResults', () => {
  it('merges two consecutive tool-result user messages into one (FIX 4)', () => {
    const m1: ChatMessage = { role: 'tool', content: 'r1', toolCallId: 'toolu_1' };
    const m2: ChatMessage = { role: 'tool', content: 'r2', toolCallId: 'toolu_2' };

    const merged = coalesceToolResults([m1, m2].map(toAnthropicMessage));

    expect(merged).toHaveLength(1);
    expect(merged[0]!.role).toBe('user');
    const content = merged[0]!.content as Anthropic.ContentBlockParam[];
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'r1' });
    expect(content[1]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_2', content: 'r2' });
  });

  it('does not merge a tool-result message with a plain user message', () => {
    const toolMsg: ChatMessage = { role: 'tool', content: 'r1', toolCallId: 'toolu_1' };
    const userMsg: ChatMessage = { role: 'user', content: 'hello' };

    const merged = coalesceToolResults([toolMsg, userMsg].map(toAnthropicMessage));

    expect(merged).toHaveLength(2);
  });
});
