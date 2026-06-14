import { z } from 'zod';
import { runSandboxed } from '../sandbox/executor.js';
import type { ToolDefinitionFull } from './types.js';
const schema = z.object({});
export const gitStatusTool: ToolDefinitionFull<z.infer<typeof schema>> = { name: 'git_status', description: 'Show git status for the workspace.', parameters: schema, risk: 'read', async run(_input, ctx) { const r = await runSandboxed({ command: 'git status --short', cwd: ctx.workspaceRoot, workspaceRoot: ctx.workspaceRoot, mode: 'read-only' }); return { ok: r.exitCode === 0, output: r.stdout || r.stderr, error: r.exitCode === 0 ? undefined : r.stderr }; } };
