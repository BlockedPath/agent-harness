import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ path: z.string(), offset: z.number().int().positive().optional(), limit: z.number().int().positive().max(500).optional() });
const MAX_SCAN_BYTES = 64 * 1024 * 1024;

export const readFileTool: ToolDefinitionFull<z.infer<typeof schema>> = {
  name: 'read_file',
  description: 'Read a range of lines from a file inside the workspace. Output is line-numbered; pass offset (1-based first line) and limit to page through large files.',
  parameters: schema,
  risk: 'read',
  async run(input, ctx) {
    const abs = resolveWorkspacePath(ctx.workspaceRoot, input.path);
    const offset = input.offset ?? 1;
    const limit = input.limit ?? 100;
    const selected: string[] = [];
    let total = 0;
    let bytes = 0;
    let exceeded = false;
    try {
      const stream = createReadStream(abs, { encoding: 'utf8' });
      stream.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_SCAN_BYTES) {
          exceeded = true;
          stream.destroy();
        }
      });
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of lines) {
        if (exceeded) {
          lines.close();
          stream.destroy();
          return { ok: false, output: '', error: `File exceeds the ${MAX_SCAN_BYTES} byte read limit.` };
        }
        total++;
        if (total >= offset && selected.length < limit) selected.push(line);
      }
      if (exceeded) return { ok: false, output: '', error: `File exceeds the ${MAX_SCAN_BYTES} byte read limit.` };
    } catch (error) {
      if (exceeded) return { ok: false, output: '', error: `File exceeds the ${MAX_SCAN_BYTES} byte read limit.` };
      return { ok: false, output: '', error: error instanceof Error ? error.message : String(error) };
    }
    if (total === 0) { total = 1; selected.push(''); }
    const start = offset;
    const slice = selected;
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
