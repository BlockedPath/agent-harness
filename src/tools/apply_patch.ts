import fs from 'node:fs/promises';
import path from 'node:path';
import { applyPatch, parsePatch } from 'diff';
import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import { snapshotFile } from '../workspace/snapshot.js';
import type { ToolDefinitionFull } from './types.js';

const schema = z.object({ patch: z.string() });

type Operation =
  | { kind: 'write'; abs: string; relPath: string; content: string }
  | { kind: 'delete'; abs: string; relPath: string };

export const applyPatchTool: ToolDefinitionFull<z.infer<typeof schema>> = {
  name: 'apply_patch',
  description: 'Apply a unified diff patch to files in the workspace (supports deletions via /dev/null).',
  parameters: schema,
  risk: 'write',
  async run(input, ctx) {
    const parsed = parsePatch(input.patch);
    if (!parsed.length) return { ok: false, output: '', error: 'Patch did not contain any files.' };

    // Phase 1 — validate every file patch and build the operation list before touching
    // disk, so a later mismatched hunk can't leave an earlier file half-applied/deleted.
    const operations: Operation[] = [];
    for (const filePatch of parsed) {
      if (isDeletion(filePatch)) {
        const relPath = normalizePatchPath(filePatch.oldFileName);
        if (!relPath) return { ok: false, output: '', error: 'Deletion patch is missing a source filename.' };
        const abs = resolveWorkspacePath(ctx.workspaceRoot, relPath);
        const oldContent = await fs.readFile(abs, 'utf8').catch(() => null);
        if (oldContent === null) return { ok: false, output: '', error: `Cannot delete missing file: ${relPath}` };
        if (applyPatch(oldContent, { ...filePatch, oldFileName: relPath, newFileName: relPath }) === false) {
          return { ok: false, output: '', error: `Patch failed for ${relPath}` };
        }
        operations.push({ kind: 'delete', abs, relPath });
        continue;
      }
      const relPath = normalizePatchPath(filePatch.newFileName ?? filePatch.oldFileName);
      if (!relPath) return { ok: false, output: '', error: 'Patch file is missing a filename.' };
      const abs = resolveWorkspacePath(ctx.workspaceRoot, relPath);
      const oldContent = await fs.readFile(abs, 'utf8').catch(() => '');
      const next = applyPatch(oldContent, { ...filePatch, oldFileName: relPath, newFileName: relPath });
      if (next === false) return { ok: false, output: '', error: `Patch failed for ${relPath}` };
      operations.push({ kind: 'write', abs, relPath, content: next });
    }

    // Phase 2 — snapshot (for undo) then apply. Validation already passed for every file.
    for (const op of operations) {
      await snapshotFile(ctx.workspaceRoot, ctx.sessionId, op.relPath);
      if (op.kind === 'delete') {
        await fs.unlink(op.abs);
      } else {
        await fs.mkdir(path.dirname(op.abs), { recursive: true });
        await fs.writeFile(op.abs, op.content);
      }
    }
    return { ok: true, output: `Applied patch to ${operations.length} file(s).` };
  },
};

function isDeletion(filePatch: { oldFileName?: string; newFileName?: string }): boolean {
  return filePatch.newFileName === '/dev/null' && filePatch.oldFileName !== '/dev/null';
}

function normalizePatchPath(fileName?: string): string | null {
  if (!fileName || fileName === '/dev/null') return null;
  return fileName.replace(/^[ab]\//, '');
}
