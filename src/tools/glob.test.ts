import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { globToRegExp, globTool } from './glob.js';

describe('globToRegExp', () => {
  it('matches * within a single path segment only', () => {
    const re = globToRegExp('src/*.ts');
    expect(re.test('src/app.ts')).toBe(true);
    expect(re.test('src/tui/app.ts')).toBe(false);
    expect(re.test('src/app.js')).toBe(false);
  });

  it('matches ** across directory boundaries', () => {
    const re = globToRegExp('src/**/*.ts');
    expect(re.test('src/app.ts')).toBe(true);
    expect(re.test('src/tui/components/input-bar.ts')).toBe(true);
    expect(re.test('lib/app.ts')).toBe(false);
  });

  it('treats ? as a single non-separator character', () => {
    const re = globToRegExp('a?.ts');
    expect(re.test('ab.ts')).toBe(true);
    expect(re.test('a/.ts')).toBe(false);
  });
});

describe('globTool', () => {
  it('returns workspace-relative paths for matching files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-glob-'));
    await fs.mkdir(path.join(root, 'src', 'tui'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'app.ts'), '');
    await fs.writeFile(path.join(root, 'src', 'tui', 'view.ts'), '');
    await fs.writeFile(path.join(root, 'src', 'readme.md'), '');

    const result = await globTool.run({ pattern: 'src/**/*.ts' }, { workspaceRoot: root, sessionId: 's', emit: () => {} });
    const lines = result.output.split('\n').sort();
    expect(lines).toEqual(['src/app.ts', 'src/tui/view.ts']);
  });

  it('reports when nothing matches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-glob-'));
    const result = await globTool.run({ pattern: '**/*.rs' }, { workspaceRoot: root, sessionId: 's', emit: () => {} });
    expect(result.output).toBe('No files matched.');
  });
});
