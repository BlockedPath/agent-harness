import fs from 'node:fs/promises';
import path from 'node:path';
import { walkWorkspace } from './glob.js';

export interface WorkspaceContext {
  fileTree: string;
  manifestSummary: string;
  agentsMd: string | null;
}

const DEFAULT_IGNORES = ['.git', 'node_modules', '.harness', '.pi', '.DS_Store', 'dist', 'coverage'];
const MANIFESTS = ['package.json', 'tsconfig.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt'];

export async function loadWorkspaceContext(workspaceRoot: string): Promise<WorkspaceContext> {
  const ignores = new Set([...DEFAULT_IGNORES, ...await readGitignore(workspaceRoot)]);
  const entries = await walkWorkspace(workspaceRoot, { maxDepth: 4, ignores });
  const fileTree = renderTree(entries);
  const manifestSummary = await summarizeManifests(workspaceRoot);
  const agentsMd = await readFirst([path.join(workspaceRoot, '.harness', 'AGENTS.md'), path.join(workspaceRoot, 'AGENTS.md')]);
  return { fileTree, manifestSummary, agentsMd };
}

async function readGitignore(workspaceRoot: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, '.gitignore'), 'utf8');
    return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => line.replace(/\/$/, ''));
  } catch { return []; }
}

function renderTree(entries: { relativePath: string; isDirectory: boolean }[]): string {
  return entries.map((entry) => `${'  '.repeat(entry.relativePath.split(path.sep).length - 1)}${path.basename(entry.relativePath)}${entry.isDirectory ? '/' : ''}`).join('\n').slice(0, 20_000);
}

async function summarizeManifests(workspaceRoot: string): Promise<string> {
  const chunks: string[] = [];
  for (const manifest of MANIFESTS) {
    const content = await readOptional(path.join(workspaceRoot, manifest));
    if (!content) continue;
    if (manifest === 'package.json') {
      try {
        const pkg = JSON.parse(content) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; bin?: unknown; main?: string; type?: string };
        chunks.push(`package.json: type=${pkg.type ?? 'commonjs'} main=${pkg.main ?? 'none'} bin=${JSON.stringify(pkg.bin ?? null)} scripts=${JSON.stringify(pkg.scripts ?? {})} dependencies=${Object.keys(pkg.dependencies ?? {}).join(', ')} devDependencies=${Object.keys(pkg.devDependencies ?? {}).join(', ')}`);
      } catch { chunks.push(`package.json: unreadable JSON`); }
    } else {
      chunks.push(`${manifest}:\n${content.split(/\r?\n/).slice(0, 40).join('\n')}`);
    }
  }
  return chunks.join('\n\n');
}

async function readFirst(paths: string[]): Promise<string | null> { for (const p of paths) { const value = await readOptional(p); if (value !== null) return value; } return null; }
async function readOptional(file: string): Promise<string | null> { try { return await fs.readFile(file, 'utf8'); } catch { return null; } }
