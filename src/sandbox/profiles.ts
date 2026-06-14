export type SandboxMode = 'read-only' | 'workspace-write' | 'dangerous';

export function buildProfile(workspaceRoot: string, mode: SandboxMode): string | null {
  const escapedRoot = workspaceRoot.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  if (mode === 'dangerous') return null;
  if (mode === 'read-only') {
    return `(version 1)
(deny default)
(allow process-exec)
(allow file-read*)
(deny file-write*)
(deny network*)`;
  }
  return `(version 1)
(deny default)
(allow process-exec)
(allow file-read*)
(allow file-write* (subpath "${escapedRoot}"))
(deny file-write* (subpath "${escapedRoot}/.harness/snapshots"))
(deny network*)`;
}
