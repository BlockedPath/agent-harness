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
    const output = await tree(root, ctx.workspaceRoot, input.depth ?? 3, gitIgnores);
    return { ok: true, output };
  },
};

async function tree(dir: string, workspaceRoot: string, depth: number, gitIgnores: Set<string>, prefix = ''): Promise<string> {
  if (depth < 0) return '';
  const entries = (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => !DEFAULT_IGNORES.has(entry.name) && !gitIgnores.has(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(`${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`);
    if (entry.isDirectory()) lines.push(await tree(path.join(dir, entry.name), workspaceRoot, depth - 1, gitIgnores, `${prefix}  `));
    if (lines.join('\n').length > 20_000) break;
  }
  return lines.filter(Boolean).join('\n');
}
