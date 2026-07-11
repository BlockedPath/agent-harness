import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { searchFilesTool } from './search_files.js';

const ctx = (workspaceRoot: string) => ({ workspaceRoot, sessionId: 's', emit: () => {} });

describe('searchFilesTool', () => {
  it('rejects a search path whose symlink leaves the workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-search-files-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-search-outside-'));
    await fs.symlink(outside, path.join(root, 'outside'));
    await expect(searchFilesTool.run({ pattern: 'secret', path: 'outside' }, ctx(root))).rejects.toThrow('Path escapes workspace');
  });
});
