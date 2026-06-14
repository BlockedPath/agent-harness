import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertInsideWorkspace } from './workspace-boundary.js';

describe('assertInsideWorkspace', () => {
  it('accepts workspace files and rejects escapes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-boundary-'));
    const file = path.join(root, 'file.txt');
    fs.writeFileSync(file, 'ok');
    expect(() => assertInsideWorkspace(file, root)).not.toThrow();
    expect(() => assertInsideWorkspace(path.resolve(root, '../../../etc/passwd'), root)).toThrow();
  });
});
