import os from 'node:os';

export type SandboxMode = 'read-only' | 'workspace-write' | 'network' | 'dangerous';

function escapePath(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

/**
 * Keep the allow-list deliberately small.  The workspace is the only mutable
 * project data; these system directories are the read-only locations needed by
 * shells and common interpreters/toolchains on macOS.
 */
function toolchainPaths(): string[] {
  const paths = new Set(['/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/local/bin', '/opt/homebrew/bin', '/System/Library', '/Library/Apple']);
  for (const entry of (process.env.PATH ?? '').split(':')) {
    if (entry.startsWith('/') && !entry.startsWith(`${os.homedir()}/`)) paths.add(entry);
  }
  const execDir = os.platform() === 'win32' ? undefined : os.tmpdir() && process.execPath;
  if (execDir) paths.add(execDir.slice(0, execDir.lastIndexOf('/')) || '/');
  return [...paths];
}

function allowList(workspaceRoot: string): string {
  const paths = [workspaceRoot, ...toolchainPaths()];
  return paths.map((p) => `(allow file-read* (subpath "${escapePath(p)}"))`).join('\n');
}

function processExecAllowList(): string {
  return toolchainPaths().map((p) => `(allow process-exec (subpath "${escapePath(p)}"))`).join('\n');
}

function denySecretReads(workspaceRoot: string): string {
  const home = escapePath(os.homedir());
  const root = escapePath(workspaceRoot);
  const subpaths = ['.ssh', '.aws', '.gnupg', '.docker', '.codex', '.kube', '.azure', '.oci', '.config/gcloud', '.config/gh', '.terraform.d'];
  const literals = ['.netrc', '.npmrc', '.git-credentials', '.pgpass', '.my.cnf', '.pypirc', '.boto', '.s3cfg', '.cargo/credentials', '.cargo/credentials.toml'];
  return [
    ...subpaths.map((p) => `(deny file-read* (subpath "${home}/${p}"))`),
    ...literals.map((p) => `(deny file-read* (literal "${home}/${p}"))`),
    `(deny file-read* (subpath "${root}/.harness/auth"))`,
  ].join('\n');
}

export function buildProfile(workspaceRoot: string, mode: SandboxMode): string | null {
  if (mode === 'dangerous') return null;
  const escapedRoot = escapePath(workspaceRoot);
  const network = mode === 'network' ? '(allow network*)' : '(deny network*)';
  const writes = mode === 'read-only' ? '(deny file-write*)' : `(allow file-write* (subpath "${escapedRoot}"))\n(deny file-write* (subpath "${escapedRoot}/.harness/snapshots"))`;
  return `(version 1)
(deny default)
${processExecAllowList()}
${allowList(workspaceRoot)}
${denySecretReads(workspaceRoot)}
${writes}
${network}`;
}
