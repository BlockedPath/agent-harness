import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileTool } from './read_file.js';

const ctx = (workspaceRoot: string) => ({ workspaceRoot, sessionId: 's', emit: () => {} });

describe('readFileTool', () => {
  it('numbers shown lines and reports the next offset', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-read-file-'));
    await fs.writeFile(path.join(root, 'f.txt'), Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n'));

    const result = await readFileTool.run({ path: 'f.txt', offset: 1, limit: 3 }, ctx(root));

    expect(result.output.startsWith('f.txt (lines 1-3 of 10)')).toBe(true);
    expect(result.output).toContain(' 1| line1');
    expect(result.output.endsWith('[truncated: 7 more lines — call read_file with offset 4]')).toBe(true);
  });

  it('does not count a final line terminator as an extra line', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-read-file-'));
    await fs.writeFile(path.join(root, 'f.txt'), 'a\nb\nc\n');

    const result = await readFileTool.run({ path: 'f.txt', offset: 1, limit: 3 }, ctx(root));

    expect(result.output).toBe('f.txt (lines 1-3 of 3)\n1| a\n2| b\n3| c');
  });

  it('treats an empty file as one empty line', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-read-file-'));
    await fs.writeFile(path.join(root, 'empty.txt'), '');

    const result = await readFileTool.run({ path: 'empty.txt' }, ctx(root));

    expect(result.output).toBe('empty.txt (lines 1-1 of 1)\n1| ');
  });

  it('reports when the requested offset is past end of file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-read-file-'));
    await fs.writeFile(path.join(root, 'f.txt'), Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n'));

    const result = await readFileTool.run({ path: 'f.txt', offset: 99999 }, ctx(root));

    expect(result.output).toBe('f.txt (no lines: offset 99999 is past end of file, 10 lines total)');
  });
});
