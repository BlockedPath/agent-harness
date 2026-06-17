import os from 'node:os';

export type SandboxMode = 'read-only' | 'workspace-write' | 'dangerous';

function escapePath(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

// Reads are otherwise allowed broadly so interpreters/toolchains keep working, but
// well-known credential stores are explicitly denied. `deny` rules placed after the
// broad `(allow file-read*)` win for these subpaths (last match wins in seatbelt).
function denySecretReads(workspaceRoot: string): string {
  const home = escapePath(os.homedir());
  const root = escapePath(workspaceRoot);
  return [
    `(deny file-read* (subpath "${home}/.ssh"))`,
    `(deny file-read* (subpath "${home}/.aws"))`,
    `(deny file-read* (subpath "${home}/.gnupg"))`,
    `(deny file-read* (subpath "${home}/.config/gcloud"))`,
    `(deny file-read* (subpath "${home}/.docker"))`,
    `(deny file-read* (subpath "${home}/.codex"))`,
    `(deny file-read* (literal "${home}/.netrc"))`,
    `(deny file-read* (literal "${home}/.npmrc"))`,
    `(deny file-read* (subpath "${root}/.harness/auth"))`,
  ].join('\n');
}

export function buildProfile(workspaceRoot: string, mode: SandboxMode): string | null {
  const escapedRoot = escapePath(workspaceRoot);
  if (mode === 'dangerous') return null;
  if (mode === 'read-only') {
    return `(version 1)
(deny default)
(allow process-exec)
(allow file-read*)
${denySecretReads(workspaceRoot)}
(deny file-write*)
(deny network*)`;
  }
  return `(version 1)
(deny default)
(allow process-exec)
(allow file-read*)
${denySecretReads(workspaceRoot)}
(allow file-write* (subpath "${escapedRoot}"))
(deny file-write* (subpath "${escapedRoot}/.harness/snapshots"))
(deny network*)`;
}
