import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPatchTool } from '../tools/apply_patch.js';

function ctx(root: string) { return { workspaceRoot: root, sessionId: 'test', emit() {} }; }

describe('apply_patch tool', () => {
  it('applies a valid unified diff', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-patch-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
    const patch = `--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-one\n+two\n`;
    const result = await applyPatchTool.run({ patch }, ctx(root));
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('two\n');
  });

  it('returns error on mismatched diff', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-patch-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
    const patch = `--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-missing\n+two\n`;
    const result = await applyPatchTool.run({ patch }, ctx(root));
    expect(result.ok).toBe(false);
  });

  it('refuses paths outside the workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-patch-'));
    const patch = `--- a/../escape.txt\n+++ b/../escape.txt\n@@ -0,0 +1,1 @@\n+bad\n`;
    await expect(applyPatchTool.run({ patch }, ctx(root))).rejects.toThrow();
  });
});
