import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileTool } from './create_file.js';

const ctx = (workspaceRoot: string) => ({ workspaceRoot, sessionId: 's', emit: () => {} });

describe('createFileTool', () => {
  it('snapshots absence before creating the file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-create-file-'));
    await createFileTool.run({ path: 'new.txt', content: 'created' }, ctx(root));
    const snapshot = path.join(root, '.harness', 'snapshots', 's');
    const files = await fs.readdir(snapshot);
    expect(files).toHaveLength(1);
    expect(await fs.readFile(path.join(snapshot, files[0]!), 'utf8')).toBe('');
  });
});
