import fs from 'node:fs/promises';
import path from 'node:path';
import { applyPatch, parsePatch } from 'diff';
import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import { snapshotFile } from '../workspace/snapshot.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ patch: z.string() });

export const applyPatchTool: ToolDefinitionFull<z.infer<typeof schema>> = {
  name: 'apply_patch',
  description: 'Apply a unified diff patch to files in the workspace.',
  parameters: schema,
  risk: 'write',
  async run(input, ctx) {
    const parsed = parsePatch(input.patch);
    if (!parsed.length) return { ok: false, output: '', error: 'Patch did not contain any files.' };
    for (const filePatch of parsed) {
      const fileName = normalizePatchPath(filePatch.newFileName ?? filePatch.oldFileName);
      if (!fileName) return { ok: false, output: '', error: 'Patch file is missing a filename.' };
      const abs = resolveWorkspacePath(ctx.workspaceRoot, fileName);
      const oldContent = await fs.readFile(abs, 'utf8').catch(() => '');
      const next = applyPatch(oldContent, { ...filePatch, oldFileName: fileName, newFileName: fileName });
      if (next === false) return { ok: false, output: '', error: `Patch failed for ${fileName}` };
      await snapshotFile(ctx.workspaceRoot, ctx.sessionId, fileName);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, next);
    }
    return { ok: true, output: `Applied patch to ${parsed.length} file(s).` };
  },
};

function normalizePatchPath(fileName?: string): string | null {
  if (!fileName || fileName === '/dev/null') return null;
  return fileName.replace(/^[ab]\//, '');
}
