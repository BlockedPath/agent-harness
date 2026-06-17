import os from 'node:os';

export type SandboxMode = 'read-only' | 'workspace-write' | 'dangerous';

function escapePath(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

// Reads are otherwise allowed broadly so interpreters/toolchains keep working, but
// well-known credential stores are explicitly denied. `deny` rules placed after the
// broad `(allow file-read*)` win for these subpaths (last match wins in seatbelt).
//
// NOTE: this is a deny-list and therefore best-effort — a relay review confirmed (via
// adversarial verification) that a broad `(allow file-read*)` combined with unscoped
// `(allow process-exec)` lets an interpreter read anything not explicitly listed here.
// The structurally sound fix is an ALLOW-list: scope reads to the workspace + the system
// paths toolchains need, and restrict `process-exec` to known interpreters. That needs
// per-platform validation against real sandbox-exec behaviour (easy to break `node`/`git`),
// so it's tracked separately; this change closes the concrete credential paths in the
// meantime. See SANDBOX_REVIEW.md for the analysis.
function denySecretReads(workspaceRoot: string): string {
  const home = escapePath(os.homedir());
  const root = escapePath(workspaceRoot);
  const subpaths = [
    '.ssh', '.aws', '.gnupg', '.docker', '.codex', '.kube', '.azure', '.oci',
    '.config/gcloud', '.config/gh', '.terraform.d',
  ];
  const literals = [
    '.netrc', '.npmrc', '.git-credentials', '.pgpass', '.my.cnf',
    '.pypirc', '.boto', '.s3cfg', '.cargo/credentials', '.cargo/credentials.toml',
  ];
  return [
    ...subpaths.map((p) => `(deny file-read* (subpath "${home}/${p}"))`),
    ...literals.map((p) => `(deny file-read* (literal "${home}/${p}"))`),
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
