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
    const messages = options.messages.filter((m) => m.role !== 'system').map(toAnthropicMessage);
    const stream = this.client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      system,
      messages,
      tools: options.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: toJsonSchema(tool.parameters) as Anthropic.Tool.InputSchema })),
    });

    async function* normalize(): AsyncIterable<StreamChunk> {
      const toolNames = new Map<number, string>();
      const toolIds = new Map<number, string>();
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          toolIds.set(event.index, event.content_block.id);
          toolNames.set(event.index, event.content_block.name);
          yield { type: 'tool_call', toolCall: { id: event.content_block.id, name: event.content_block.name, arguments: '' } };
        }
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') yield { type: 'content', content: event.delta.text };
          if (event.delta.type === 'input_json_delta') {
            yield { type: 'tool_call', toolCall: { id: toolIds.get(event.index), name: toolNames.get(event.index), arguments: event.delta.partial_json } };
          }
        }
        if (event.type === 'message_delta' && event.usage) {
          const input = event.usage.input_tokens ?? 0;
          const output = event.usage.output_tokens ?? 0;
          yield { type: 'usage', usage: { promptTokens: input, completionTokens: output, totalTokens: input + output } };
        }
      }
    }

    return normalize();
  }
}

function toAnthropicMessage(message: ChatMessage): Anthropic.MessageParam {
  if (message.role === 'tool') {
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId ?? '', content: message.content }] };
  }
  if (message.toolCalls?.length) {
    return { role: 'assistant', content: [{ type: 'text', text: message.content }, ...message.toolCalls.map((call) => ({ type: 'tool_use' as const, id: call.id, name: call.function.name, input: safeJson(call.function.arguments) }))] };
  }
  return { role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content };
}

function safeJson(input: string): unknown {
  try { return JSON.parse(input || '{}'); } catch { return {}; }
}
