import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_IGNORES: Set<string> = new Set(['node_modules', '.git', '.harness', '.pi', '.DS_Store', 'dist']);

export async function readGitignore(workspaceRoot: string): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, '.gitignore'), 'utf8');
    return new Set(raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => line.replace(/\/$/, '')));
  } catch { return new Set(); }
}
