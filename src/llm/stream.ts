import type { StreamChunk, ToolCall } from './types.js';

export interface AggregatedStream {
  content: string;
  toolCalls: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export async function aggregateStream(stream: AsyncIterable<StreamChunk>, onContent?: (text: string) => void): Promise<AggregatedStream> {
  let content = '';
  const toolCalls = new Map<string, ToolCall>();
  let anonymousIndex = 0;
  let usage: AggregatedStream['usage'];

  for await (const chunk of stream) {
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
    }
  }

  return { content, toolCalls: [...toolCalls.values()].filter((call) => call.function.name), usage };
}
