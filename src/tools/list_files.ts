import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import { DEFAULT_IGNORES, readGitignore } from '../workspace/ignores.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ path: z.string().optional(), depth: z.number().int().positive().max(8).optional() });

export const listFilesTool: ToolDefinitionFull<z.infer<typeof schema>> = {
  name: 'list_files',
  description: 'List files in the workspace as a compact ASCII tree.',
  parameters: schema,
  risk: 'read',
  async run(input, ctx) {
    const root = resolveWorkspacePath(ctx.workspaceRoot, input.path ?? '.');
    const gitIgnores = await readGitignore(ctx.workspaceRoot);
    const state = { lines: [] as string[], length: 0, truncated: false };
    await tree(root, ctx.workspaceRoot, input.depth ?? 3, gitIgnores, '', state);
    return { ok: true, output: state.lines.join('\n') + (state.truncated ? '\n... [truncated]' : '') };
  },
};

const OUTPUT_LIMIT = 20_000;

async function tree(dir: string, workspaceRoot: string, depth: number, gitIgnores: Set<string>, prefix: string, state: { lines: string[]; length: number; truncated: boolean }): Promise<void> {
  if (depth < 0 || state.truncated) return;
  const entries = (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => !DEFAULT_IGNORES.has(entry.name) && !gitIgnores.has(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const line = `${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`;
    state.lines.push(line);
    state.length += line.length + 1;
    if (state.length > OUTPUT_LIMIT) { state.truncated = true; return; }
    if (entry.isDirectory()) await tree(path.join(dir, entry.name), workspaceRoot, depth - 1, gitIgnores, `${prefix}  `, state);
  }
}
