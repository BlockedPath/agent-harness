import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPatchTool } from '../tools/apply_patch.js';
import { requiresApproval } from '../policy/approval.js';
import type { PermissionConfig } from '../policy/types.js';

function ctx(root: string) { return { workspaceRoot: root, sessionId: 'test', emit() {} }; }
const autoPerms: PermissionConfig = { mode: 'auto', read: 'allow', write: 'allow', execute: 'allow', network: 'allow' };

describe('apply_patch tool', () => {
  it('requires dangerous approval for deletion patches under auto mode', () => {
    const patch = `--- a/a.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-one\n`;
    expect(applyPatchTool.riskForApproval?.({ patch })).toBe('dangerous');
    expect(requiresApproval(applyPatchTool.riskForApproval?.({ patch }) ?? applyPatchTool.risk, autoPerms)).toBe(true);
    const writePatch = `--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-one\n+two\n`;
    expect(applyPatchTool.riskForApproval?.({ patch: writePatch })).toBe('write');
    expect(requiresApproval(applyPatchTool.riskForApproval?.({ patch: writePatch }) ?? applyPatchTool.risk, autoPerms)).toBe(false);
  });

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

  it('deletes a file for a unified diff deletion patch and snapshots it first', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-patch-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\n');
    const patch = `--- a/a.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n`;
    const result = await applyPatchTool.run({ patch }, ctx(root));
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(false);
    const snaps = findFiles(path.join(root, '.harness', 'snapshots', 'test'));
    const snapshot = snaps.find((file) => file.endsWith('a.txt'));
    expect(snapshot).toBeDefined();
    expect(fs.readFileSync(snapshot!, 'utf8')).toBe('one\ntwo\n');
  });

  it('does not partially apply a multi-file patch when a later file fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-patch-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'delete me\n');
    fs.writeFileSync(path.join(root, 'b.txt'), 'actual\n');
    const patch =
      `--- a/a.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-delete me\n` +
      `--- a/b.txt\n+++ b/b.txt\n@@ -1,1 +1,1 @@\n-expected\n+changed\n`;
    const result = await applyPatchTool.run({ patch }, ctx(root));
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('delete me\n');
    expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf8')).toBe('actual\n');
    expect(fs.existsSync(path.join(root, '.harness', 'snapshots'))).toBe(false);
  });
});

function findFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? findFiles(full) : [full];
  });
}
