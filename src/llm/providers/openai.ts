import OpenAI from 'openai';
import type { ChatMessage, LlmProvider, StreamChunk, ToolDefinition } from '../types.js';
import { toJsonSchema } from '../../util/json-schema.js';

export class OpenAiProvider implements LlmProvider {
  id = 'openai';
  name = 'OpenAI';
  private client: OpenAI;

  constructor(options: { apiKey: string; baseUrl?: string }) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl });
  }

  async stream(options: { model: string; messages: ChatMessage[]; tools: ToolDefinition[]; temperature?: number; maxTokens?: number }): Promise<AsyncIterable<StreamChunk>> {
    const response = await this.client.chat.completions.create({
      model: options.model,
      messages: options.messages.map(toOpenAiMessage),
      tools: options.tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: toJsonSchema(tool.parameters),
        },
      })),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    async function* normalize(): AsyncIterable<StreamChunk> {
      for await (const chunk of response) {
        const choice = chunk.choices[0];
        const delta = choice?.delta;
        if (delta?.content) yield { type: 'content', content: delta.content };
        for (const call of delta?.tool_calls ?? []) {
          yield { type: 'tool_call', toolCall: { id: call.id, name: call.function?.name, arguments: call.function?.arguments } };
        }
        if (chunk.usage) {
          yield { type: 'usage', usage: { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, totalTokens: chunk.usage.total_tokens } };
        }
      }
    }

    return normalize();
  }
}

function toOpenAiMessage(message: ChatMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
  if (message.role === 'assistant') {
    const toolCalls = message.toolCalls?.map((call) => ({ id: call.id, type: 'function' as const, function: call.function }));
    return { role: 'assistant', content: message.content, ...(toolCalls?.length ? { tool_calls: toolCalls } : {}) };
  }
  if (message.role === 'system') return { role: 'system', content: message.content };
  return { role: 'user', content: message.content };
}
