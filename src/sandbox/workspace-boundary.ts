import fs from 'node:fs';
import path from 'node:path';

export function assertInsideWorkspace(absPath: string, workspaceRoot: string): void {
  const root = fs.realpathSync(workspaceRoot);
  const target = realpathForBoundary(absPath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path escapes workspace: ${absPath}`);
  }
}

export function resolveWorkspacePath(workspaceRoot: string, relativePath = '.'): string {
  const abs = path.resolve(workspaceRoot, relativePath);
  assertInsideWorkspace(abs, workspaceRoot);
  return abs;
}

function realpathForBoundary(absPath: string): string {
  if (fs.existsSync(absPath)) return fs.realpathSync(absPath);
  const parent = path.dirname(absPath);
  const realParent = fs.existsSync(parent) ? fs.realpathSync(parent) : realpathForBoundary(parent);
  return path.join(realParent, path.basename(absPath));
}
