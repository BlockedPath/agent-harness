import type { z } from 'zod';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDefinition<T = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<T>;
}

export interface StreamChunk {
  type: 'content' | 'tool_call' | 'usage';
  content?: string;
  toolCall?: { id?: string; name?: string; arguments?: string };
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface LlmProvider {
  id: string;
  name: string;
  stream(options: {
    model: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<AsyncIterable<StreamChunk>>;
}
