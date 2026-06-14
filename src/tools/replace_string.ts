import fs from 'node:fs/promises';
import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import { snapshotFile } from '../workspace/snapshot.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ path: z.string(), oldString: z.string(), newString: z.string() });
export const replaceStringTool: ToolDefinitionFull<z.infer<typeof schema>> = { name: 'replace_string', description: 'Replace one exact string occurrence in a workspace file.', parameters: schema, risk: 'write', async run(input, ctx) { const abs = resolveWorkspacePath(ctx.workspaceRoot, input.path); const content = await fs.readFile(abs, 'utf8'); const count = content.split(input.oldString).length - 1; if (count !== 1) return { ok: false, output: '', error: `oldString matched ${count} times; expected exactly once.` }; await snapshotFile(ctx.workspaceRoot, ctx.sessionId, input.path); await fs.writeFile(abs, content.replace(input.oldString, input.newString)); return { ok: true, output: `Updated ${input.path}` }; } };
