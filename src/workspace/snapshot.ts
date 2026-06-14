import fs from 'node:fs/promises';
import path from 'node:path';

export async function snapshotFile(workspaceRoot: string, sessionId: string, relativePath: string): Promise<string> {
  const timestamp = Date.now();
  const clean = relativePath.replace(/^\/+/, '');
  const snapshotPath = path.join(workspaceRoot, '.harness', 'snapshots', sessionId, `${timestamp}-${clean}`);
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  const source = path.join(workspaceRoot, clean);
  try {
    await fs.copyFile(source, snapshotPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.writeFile(snapshotPath, '');
  }
  return snapshotPath;
}
