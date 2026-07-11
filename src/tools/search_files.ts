import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { z } from 'zod';
import { sanitizeEnv } from '../sandbox/executor.js';
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
    // Keep recursive searches from following symlinks discovered below the
    // requested directory. The workspace-boundary check covers the root, but
    // a nested symlink can otherwise expose files outside it.
    const args = hasRg ? ['--no-follow', '--json', '-n', '-C', '2', input.pattern, target] : ['-r', '-n', input.pattern, target];
    const result = await collect(hasRg ? 'rg' : 'grep', args, ctx.workspaceRoot);
    return { ok: result.exitCode === 0 || result.exitCode === 1, output: result.output.split(/\r?\n/).slice(0, 200).join('\n') };
  },
};

async function commandExists(command: string): Promise<boolean> {
  for (const candidate of [`/opt/homebrew/bin/${command}`, `/usr/bin/${command}`]) {
    try {
      await access(candidate);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}
const MAX_OUTPUT_BYTES = 20_000;

function collect(command: string, args: string[], cwd: string): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: sanitizeEnv(process.env) });
    let output = '';
    let truncated = false;
    let settled = false;
    const settle = (result: { exitCode: number | null; output: string }) => { if (settled) return; settled = true; resolve(result); };
    const append = (chunk: Buffer) => {
      if (truncated) return;
      const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(output);
      const marker = '\n[truncated]';
      if (chunk.byteLength <= remaining) output += chunk.toString();
      else {
        // The cap applies to the complete response, including its marker.
        const contentBytes = Math.max(0, remaining - Buffer.byteLength(marker));
        output += chunk.subarray(0, contentBytes).toString();
        output += marker.slice(0, Math.max(0, remaining - contentBytes));
        truncated = true;
        child.kill('SIGTERM');
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    // Spawn failure (e.g. rg/grep missing) emits 'error' and may never emit 'close';
    // resolve with a non-zero exit so the tool reports an error instead of hanging.
    child.on('error', (err: Error) => settle({ exitCode: -1, output: output || err.message }));
    child.on('close', (exitCode) => settle({ exitCode, output }));
  });
}
