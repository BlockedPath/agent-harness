import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './loader.js';

let root: string;
let home: string;

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
}

describe('loadConfig tools policy', () => {
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-config-root-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-config-home-'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to an empty deny list', async () => {
    const config = await loadConfig(root);

    expect(config.tools.deny).toEqual([]);
  });

  it('loads project tool deny policy', async () => {
    await writeJson(path.join(root, '.harness', 'config.json'), { tools: { deny: ['run_command'] } });

    const config = await loadConfig(root);

    expect(config.tools.deny).toEqual(['run_command']);
  });

  it('lets explicit config override the project tool deny policy', async () => {
    await writeJson(path.join(root, '.harness', 'config.json'), { tools: { deny: ['run_command'] } });
    const explicitPath = path.join(root, 'explicit.json');
    await writeJson(explicitPath, { tools: { deny: ['read_file'] } });

    const config = await loadConfig(root, explicitPath);

    expect(config.tools.deny).toEqual(['read_file']);
  });
});
