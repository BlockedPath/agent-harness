import type { StreamChunk, ToolCall } from './types.js';

export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 30_000;

export interface AggregatedStream {
  content: string;
  toolCalls: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface ToolCallDelta {
  /** Stable id for this call; matches the assembled ToolCall.id. */
  id: string;
  /** Cumulative tool name seen so far (may be empty until the provider sends it). */
  name: string;
  /** Cumulative argument text seen so far — not necessarily valid JSON yet. */
  partialArgs: string;
}

export async function aggregateStream(
  stream: AsyncIterable<StreamChunk>,
  onContent?: (text: string) => void,
  onToolCall?: (delta: ToolCallDelta) => void,
  idleTimeoutMs = DEFAULT_STREAM_IDLE_TIMEOUT_MS,
): Promise<AggregatedStream> {
  let content = '';
  const toolCalls = new Map<string, ToolCall>();
  let anonymousIndex = 0;
  let usage: AggregatedStream['usage'];

  const iterator = stream[Symbol.asyncIterator]();
  while (true) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const next = iterator.next();
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('provider stream timed out')), idleTimeoutMs);
    });
    let result: IteratorResult<StreamChunk>;
    try {
      result = await Promise.race([next, timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (result.done) break;
    const chunk = result.value;
    if (chunk.type === 'content') {
      const text = chunk.content ?? '';
      content += text;
      onContent?.(text);
      continue;
    }
    if (chunk.type === 'usage') {
      usage = chunk.usage;
      continue;
    }
    if (chunk.type === 'tool_call') {
      const id = chunk.toolCall?.id ?? `tool-${anonymousIndex++}`;
      const existing = toolCalls.get(id) ?? { id, type: 'function' as const, function: { name: '', arguments: '' } };
      existing.function.name += chunk.toolCall?.name ?? '';
      existing.function.arguments += chunk.toolCall?.arguments ?? '';
      toolCalls.set(id, existing);
      onToolCall?.({ id, name: existing.function.name, partialArgs: existing.function.arguments });
    }
  }

  return { content, toolCalls: [...toolCalls.values()].filter((call) => call.function.name), usage };
}
