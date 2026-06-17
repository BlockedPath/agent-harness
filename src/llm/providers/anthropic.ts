import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, LlmProvider, StreamChunk, ToolDefinition } from '../types.js';
import { toJsonSchema } from '../../util/json-schema.js';

export class AnthropicProvider implements LlmProvider {
  id = 'anthropic';
  name = 'Anthropic';
  private client: Anthropic;

  constructor(options: { apiKey: string; baseUrl?: string }) {
    this.client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseUrl });
  }

  async stream(options: { model: string; messages: ChatMessage[]; tools: ToolDefinition[]; temperature?: number; maxTokens?: number }): Promise<AsyncIterable<StreamChunk>> {
    const system = options.messages.find((m) => m.role === 'system')?.content;
    const mapped = options.messages.filter((m) => m.role !== 'system').map(toAnthropicMessage);
    const messages = coalesceToolResults(mapped);
    const stream = this.client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      system,
      messages,
      tools: options.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: toJsonSchema(tool.parameters) as Anthropic.Tool.InputSchema })),
    });

    return normalizeAnthropicStream(stream);
  }
}

export async function* normalizeAnthropicStream(stream: AsyncIterable<Anthropic.MessageStreamEvent>): AsyncIterable<StreamChunk> {
  const toolIds = new Map<number, string>();
  let inputTokens = 0;
  for await (const event of stream) {
    if (event.type === 'message_start') {
      inputTokens = event.message.usage.input_tokens ?? 0;
    }
    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
      toolIds.set(event.index, event.content_block.id);
      // Emit `name` exactly once here; deltas carry only arguments so the
      // aggregator (which concatenates name across chunks) keeps the bare name.
      yield { type: 'tool_call', toolCall: { id: event.content_block.id, name: event.content_block.name, arguments: '' } };
    }
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') yield { type: 'content', content: event.delta.text };
      if (event.delta.type === 'input_json_delta') {
        yield { type: 'tool_call', toolCall: { id: toolIds.get(event.index), arguments: event.delta.partial_json } };
      }
    }
    if (event.type === 'message_delta' && event.usage) {
      // input_tokens is null on message_delta; use the value captured at message_start.
      const input = inputTokens ?? 0;
      const output = event.usage.output_tokens ?? 0;
      yield { type: 'usage', usage: { promptTokens: input, completionTokens: output, totalTokens: input + output } };
    }
  }
}

export function toAnthropicMessage(message: ChatMessage): Anthropic.MessageParam {
  if (message.role === 'tool') {
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId ?? '', content: message.content }] };
  }
  if (message.toolCalls?.length) {
    const toolUses = message.toolCalls.map((call) => ({ type: 'tool_use' as const, id: call.id, name: call.function.name, input: safeJson(call.function.arguments) }));
    return { role: 'assistant', content: [...(message.content ? [{ type: 'text' as const, text: message.content }] : []), ...toolUses] };
  }
  return { role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content };
}

/**
 * Merge consecutive user messages whose content is entirely tool_result blocks
 * into a single user message. Anthropic accepts (and prefers) all tool_results
 * for a turn collected into one user message.
 */
export function coalesceToolResults(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const isToolResultMessage = (m: Anthropic.MessageParam): boolean =>
    m.role === 'user'
    && Array.isArray(m.content)
    && m.content.length > 0
    && m.content.every((block) => typeof block === 'object' && block.type === 'tool_result');

  const result: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    const prev = result[result.length - 1];
    if (prev && isToolResultMessage(prev) && isToolResultMessage(message)) {
      prev.content = [...(prev.content as Anthropic.ContentBlockParam[]), ...(message.content as Anthropic.ContentBlockParam[])];
    } else {
      result.push(message);
    }
  }
  return result;
}

function safeJson(input: string): unknown {
  try { return JSON.parse(input || '{}'); } catch { return {}; }
}
