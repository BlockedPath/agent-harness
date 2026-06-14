import type { z } from 'zod';
import type { AgentEvent } from '../agent/types.js';

export type RiskLevel = 'read' | 'write' | 'execute' | 'network' | 'dangerous';

export interface ToolContext {
  workspaceRoot: string;
  sessionId: string;
  emit(event: AgentEvent): void;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
}

export interface ToolDefinitionFull<T = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<T>;
  risk: RiskLevel;
  run(input: T, ctx: ToolContext): Promise<ToolResult>;
}
