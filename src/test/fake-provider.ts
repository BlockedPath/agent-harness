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
