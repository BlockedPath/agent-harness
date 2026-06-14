import type { ChatMessage, LlmProvider, StreamChunk, ToolDefinition } from '../types.js';

export class TemplateProvider implements LlmProvider {
  id = 'template';
  name = 'Template Provider';

  async stream(_options: { model: string; messages: ChatMessage[]; tools: ToolDefinition[]; temperature?: number; maxTokens?: number }): Promise<AsyncIterable<StreamChunk>> {
    throw new Error('not implemented');
  }
}
