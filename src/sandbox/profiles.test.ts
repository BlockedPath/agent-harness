import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildProfile } from './profiles.js';

describe('buildProfile', () => {
  const home = os.homedir();

  it('keeps dangerous mode as the explicit unsandboxed opt-in', () => {
    expect(buildProfile('/tmp/ws', 'dangerous')).toBeNull();
  });

  it('provides a network profile without disabling isolation', () => {
    const profile = buildProfile('/tmp/ws', 'network')!;
    expect(profile).not.toBeNull();
    expect(profile).toContain('(allow network*)');
    expect(profile).not.toContain('(deny network*)');
    expect(profile).not.toContain('(allow file-read*)');
    expect(profile).toContain('(deny file-read* (subpath');
  });

  it('denies known credential stores in workspace-write mode', () => {
    const profile = buildProfile('/tmp/ws', 'workspace-write')!;
    for (const p of ['.ssh', '.aws', '.kube', '.config/gh', '.terraform.d']) {
      expect(profile).toContain(`(deny file-read* (subpath "${home}/${p}"))`);
    }
    for (const p of ['.git-credentials', '.pgpass', '.pypirc', '.npmrc', '.s3cfg']) {
      expect(profile).toContain(`(deny file-read* (literal "${home}/${p}"))`);
    }
  });

  it('denies git-credentials and kube config specifically (the verified P0 gap)', () => {
    const profile = buildProfile('/tmp/ws', 'workspace-write')!;
    expect(profile).toContain(`(deny file-read* (literal "${home}/.git-credentials"))`);
    expect(profile).toContain(`(deny file-read* (subpath "${home}/.kube"))`);
  });

  it('scopes writes to the workspace and protects snapshots', () => {
    const profile = buildProfile('/tmp/ws', 'workspace-write')!;
    expect(profile).toContain('(allow file-write* (subpath "/tmp/ws"))');
    expect(profile).toContain('(deny file-write* (subpath "/tmp/ws/.harness/snapshots"))');
    expect(profile).toContain('(deny network*)');
    expect(profile).not.toContain('(allow file-read*)');
  });

  it('read-only mode denies all writes but keeps the secret denies', () => {
    const profile = buildProfile('/tmp/ws', 'read-only')!;
    expect(profile).toContain('(deny file-write*)');
    expect(profile).toContain(`(deny file-read* (literal "${home}/.git-credentials"))`);
  });
});
