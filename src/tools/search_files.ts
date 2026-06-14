import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ pattern: z.string(), path: z.string().optional() });

export const searchFilesTool: ToolDefinitionFull<z.infer<typeof schema>> = {
  name: 'search_files',
  description: 'Search workspace files for a regex pattern.',
  parameters: schema,
  risk: 'read',
  async run(input, ctx) {
    const target = resolveWorkspacePath(ctx.workspaceRoot, input.path ?? '.');
    const hasRg = await commandExists('rg');
    const args = hasRg ? ['--json', '-n', '-C', '2', input.pattern, target] : ['-R', '-n', input.pattern, target];
    const result = await collect(hasRg ? 'rg' : 'grep', args, ctx.workspaceRoot);
    return { ok: result.exitCode === 0 || result.exitCode === 1, output: result.output.split(/\r?\n/).slice(0, 200).join('\n') };
  },
};

async function commandExists(command: string): Promise<boolean> { try { await access(`/opt/homebrew/bin/${command}`); return true; } catch {} try { await access(`/usr/bin/${command}`); return true; } catch { return false; } }
function collect(command: string, args: string[], cwd: string): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('close', (exitCode) => resolve({ exitCode, output }));
  });
}
