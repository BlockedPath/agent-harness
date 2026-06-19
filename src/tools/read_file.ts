import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ path: z.string(), offset: z.number().int().positive().optional(), limit: z.number().int().positive().max(500).optional() });

export const readFileTool: ToolDefinitionFull<z.infer<typeof schema>> = {
  name: 'read_file',
  description: 'Read a range of lines from a file inside the workspace. Output is line-numbered; pass offset (1-based first line) and limit to page through large files.',
  parameters: schema,
  risk: 'read',
  async run(input, ctx) {
    const abs = resolveWorkspacePath(ctx.workspaceRoot, input.path);
    const content = await fs.readFile(abs, 'utf8');
    const lines = content.split(/\r?\n/);
    if (content.endsWith('\n')) lines.pop();
    const offset = input.offset ?? 1;
    const limit = input.limit ?? 100;
    const total = lines.length;
    const start = offset;
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const end = offset - 1 + slice.length;
    const rel = path.relative(ctx.workspaceRoot, abs);

    if (slice.length === 0) {
      return { ok: true, output: `${rel} (no lines: offset ${offset} is past end of file, ${total} lines total)` };
    }

    const width = String(total).length;
    const numbered = slice.map((line, i) => `${String(offset + i).padStart(width)}| ${line}`).join('\n');
    const header = `${rel} (lines ${start}-${end} of ${total})`;
    const suffix = end < total ? `\n[truncated: ${total - end} more lines — call read_file with offset ${end + 1}]` : '';
    return { ok: true, output: `${header}\n${numbered}${suffix}` };
  },
};
