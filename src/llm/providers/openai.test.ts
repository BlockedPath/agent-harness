import { describe, expect, it } from 'vitest';
import { aggregateStream } from '../stream.js';

// Mock the OpenAI SDK so provider.stream() yields a scripted streaming response that
// reproduces real Chat Completions behaviour: id+name only on the first tool-call
// delta, later argument fragments keyed by `index` with id/name omitted.
import { vi } from 'vitest';
vi.mock('openai', () => {
  async function* response() {
    yield { choices: [{ delta: { content: 'before ' } }] };
    yield { choices: [{ delta: { tool_calls: [
      { index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"path"' } },
      { index: 1, id: 'call_b', function: { name: 'list_files', arguments: '{"path"' } },
    ] } }] };
    yield { choices: [{ delta: { content: 'after' } }] };
    yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"a.ts"}' } }] } }] };
    yield { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: ':"src"}' } }] } }] };
    yield { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } };
  }
  return { default: class { chat = { completions: { create: async () => response() } }; } };
});

import { OpenAiProvider } from './openai.js';

describe('OpenAiProvider streaming', () => {
  it('keeps tool-call argument deltas keyed by index when later chunks omit id and name', async () => {
    const provider = new OpenAiProvider({ apiKey: 'test' });
    const stream = await provider.stream({ model: 'gpt-test', messages: [], tools: [] });
    const result = await aggregateStream(stream);

    expect(result.content).toBe('before after');
    expect(result.usage?.totalTokens).toBe(7);
    expect(result.toolCalls).toHaveLength(2);

    const a = result.toolCalls.find((call) => call.id === 'call_a');
    const b = result.toolCalls.find((call) => call.id === 'call_b');
    expect(a?.function.name).toBe('read_file');
    expect(a?.function.arguments).toBe('{"path":"a.ts"}');
    expect(JSON.parse(a!.function.arguments)).toEqual({ path: 'a.ts' });
    expect(b?.function.name).toBe('list_files');
    expect(b?.function.arguments).toBe('{"path":"src"}');
  });
});
