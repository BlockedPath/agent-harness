import { z } from 'zod';
import { classifyCommand } from '../policy/classifier.js';
import { runSandboxed } from '../sandbox/executor.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ command: z.string(), timeout: z.number().int().positive().optional() });
export const runCommandTool: ToolDefinitionFull<z.infer<typeof schema>> = { name: 'run_command', description: 'Run a shell command in the workspace.', parameters: schema, risk: 'execute', async run(input, ctx) { const risk = classifyCommand(input.command); const mode = risk === 'dangerous' || risk === 'network' ? 'dangerous' : 'workspace-write'; const result = await runSandboxed({ command: input.command, cwd: ctx.workspaceRoot, workspaceRoot: ctx.workspaceRoot, mode, timeoutMs: (input.timeout ?? 60) * 1000 }); return { ok: result.exitCode === 0, output: `exitCode=${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`, error: result.exitCode === 0 ? undefined : result.stderr || `Command exited ${result.exitCode}` }; } };
