import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { buildProfile, type SandboxMode } from './profiles.js';
import { assertInsideWorkspace } from './workspace-boundary.js';

export interface RunOptions {
  command: string;
  cwd: string;
  workspaceRoot?: string;
  mode: SandboxMode;
  timeoutMs?: number;
  outputLimit?: number;
}

export interface RunResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; }

export async function runSandboxed(options: RunOptions): Promise<RunResult> {
  const workspaceRoot = options.workspaceRoot ?? options.cwd;
  assertInsideWorkspace(options.cwd, workspaceRoot);
  const limit = options.outputLimit ?? 20_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const profile = process.platform === 'darwin' ? buildProfile(workspaceRoot, options.mode) : null;
  const useSandbox = profile && await sandboxExecExists();
  const command = useSandbox ? 'sandbox-exec' : '/bin/sh';
  const args = useSandbox ? ['-p', profile, '/bin/sh', '-c', options.command] : ['-c', options.command];

  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString();
      return next.length > limit ? next.slice(0, limit) + '\n[truncated]' : next;
    };
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on('close', (exitCode) => { clearTimeout(timer); resolve({ exitCode: timedOut ? -1 : exitCode, stdout, stderr, timedOut }); });
  });
}

async function sandboxExecExists(): Promise<boolean> {
  try { await access('/usr/bin/sandbox-exec', constants.X_OK); return true; } catch { return false; }
}
