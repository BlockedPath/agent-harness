import fs from 'node:fs/promises';
import path from 'node:path';

export interface WalkOptions { maxDepth: number; ignores: Set<string>; }
export interface WalkEntry { relativePath: string; isDirectory: boolean; }

export async function walkWorkspace(root: string, options: WalkOptions, dir = root, depth = 0): Promise<WalkEntry[]> {
  if (depth > options.maxDepth) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: WalkEntry[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (options.ignores.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const relativePath = path.relative(root, abs);
    out.push({ relativePath, isDirectory: entry.isDirectory() });
    if (entry.isDirectory()) out.push(...await walkWorkspace(root, options, abs, depth + 1));
  }
  return out;
}
