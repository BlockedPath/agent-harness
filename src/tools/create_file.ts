import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import { snapshotFile } from '../workspace/snapshot.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ path: z.string(), content: z.string() });
export const createFileTool: ToolDefinitionFull<z.infer<typeof schema>> = { name: 'create_file', description: 'Create a new file inside the workspace.', parameters: schema, risk: 'write', async run(input, ctx) { const abs = resolveWorkspacePath(ctx.workspaceRoot, input.path); await snapshotFile(ctx.workspaceRoot, ctx.sessionId, input.path); await fs.mkdir(path.dirname(abs), { recursive: true }); await fs.writeFile(abs, input.content, { flag: 'wx' }); return { ok: true, output: `Created ${input.path}` }; } };
