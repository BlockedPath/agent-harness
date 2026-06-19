import type { LlmProvider, StreamChunk } from '../llm/types.js';

/**
 * A turn-aware fake LLM provider for driving the agent loop in tests.
 *
 * The agent loop calls `provider.stream()` once per iteration. To exercise a
 * tool turn followed by a clean finish, supply the tool-call chunks as one turn
 * and a final content-only turn afterwards, e.g.
 *
 *   scriptedProvider([[toolCallChunk], [finalContentChunk]])
 *
 * On the i-th call to `stream()` it yields the chunks of `turns[i]`. Once the
 * scripted turns are exhausted it yields an empty turn (no chunks), which the
 * loop treats as a finished turn with no tool calls and ends cleanly.
 */
export function scriptedProvider(turns: StreamChunk[][]): LlmProvider {
  let call = 0;
  return {
    id: 'fake',
    name: 'Fake',
    async stream() {
      const chunks = turns[call] ?? [];
      call += 1;
      return (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
    },
  };
}

/**
 * A provider whose stream yields the given chunks and then throws, simulating a
 * network drop after partial content / partial tool-call deltas. The throw is
 * inside the async generator, so it surfaces while `aggregateStream` is
 * consuming the iterator (the realistic mid-stream failure point).
 */
export function failingStreamProvider(chunks: StreamChunk[], errorMessage: string): LlmProvider {
  return {
    id: 'fake',
    name: 'Fake',
    async stream() {
      return (async function* () {
        for (const chunk of chunks) yield chunk;
        throw new Error(errorMessage);
      })();
    },
  };
}
