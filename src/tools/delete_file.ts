import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ path: z.string() });
export const deleteFileTool: ToolDefinitionFull<z.infer<typeof schema>> = { name: 'delete_file', description: 'Move a workspace file into the session snapshot deleted folder.', parameters: schema, risk: 'dangerous', async run(input, ctx) { const abs = resolveWorkspacePath(ctx.workspaceRoot, input.path); const dest = path.join(ctx.workspaceRoot, '.harness', 'snapshots', ctx.sessionId, 'deleted', input.path); await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.rename(abs, dest); return { ok: true, output: `Moved ${input.path} to ${path.relative(ctx.workspaceRoot, dest)}` }; } };
