import { z } from 'zod';
import { classifyCommand } from '../policy/classifier.js';
import { runSandboxed } from '../sandbox/executor.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ command: z.string(), timeout: z.number().int().positive().optional() });
export function modeForCommand(command: string): 'workspace-write' | 'network' | 'dangerous' {
  const risk = classifyCommand(command);
  if (risk === 'dangerous') return 'dangerous';
  if (risk === 'network') return 'network';
  return 'workspace-write';
}
export const runCommandTool: ToolDefinitionFull<z.infer<typeof schema>> = { name: 'run_command', description: 'Run a shell command in the workspace. Network commands use an isolated network-enabled sandbox; dangerous commands require explicit approval and are loudly labeled.', parameters: schema, risk: 'execute', async run(input, ctx) { const result = await runSandboxed({ command: input.command, cwd: ctx.workspaceRoot, workspaceRoot: ctx.workspaceRoot, mode: modeForCommand(input.command), timeoutMs: (input.timeout ?? 60) * 1000 }); return { ok: result.exitCode === 0, output: `exitCode=${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`, error: result.exitCode === 0 ? undefined : result.stderr || `Command exited ${result.exitCode}` }; } };
