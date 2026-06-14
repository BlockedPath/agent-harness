import { z } from 'zod';
import type { ToolDefinitionFull } from './types.js';
const schema = z.object({ question: z.string() });
export const askUserTool: ToolDefinitionFull<z.infer<typeof schema>> = { name: 'ask_user', description: 'Ask the user a question and wait for the answer.', parameters: schema, risk: 'read', async run(input, ctx) { const answer = await new Promise<string>((resolve) => ctx.emit({ type: 'question', question: input.question, resolve })); return { ok: true, output: answer }; } };
