import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ path: z.string(), offset: z.number().int().positive().optional(), limit: z.number().int().positive().max(500).optional() });

export const readFileTool: ToolDefinitionFull<z.infer<typeof schema>> = {
  name: 'read_file',
  description: 'Read a range of lines from a file inside the workspace.',
  parameters: schema,
  risk: 'read',
  async run(input, ctx) {
    const abs = resolveWorkspacePath(ctx.workspaceRoot, input.path);
    const content = await fs.readFile(abs, 'utf8');
    const lines = content.split(/\r?\n/);
    const offset = input.offset ?? 1;
    const limit = input.limit ?? 100;
    const selected = lines.slice(offset - 1, offset - 1 + limit).join('\n');
    const suffix = lines.length > offset - 1 + limit ? '\n[truncated: use read_file with offset]' : '';
    return { ok: true, output: `${path.relative(ctx.workspaceRoot, abs)}\n${selected}${suffix}` };
  },
};
