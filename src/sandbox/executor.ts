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

// Secrets are never exported into the child's environment. Even when a command runs
// unsandboxed (non-darwin, or `dangerous` mode), this prevents `echo $OPENAI_API_KEY`
// style exfiltration of provider/CI credentials into tool output.
const SENSITIVE_ENV = /(API_KEY|_KEY$|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_AUTH$|SESSION)/i;

function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (SENSITIVE_ENV.test(key)) continue;
    out[key] = value;
  }
  return out;
}

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
    // `detached` makes the child a process-group leader so the whole tree can be
    // signalled on timeout (otherwise only the wrapping /bin/sh dies, orphaning children).
    const child = spawn(command, args, { cwd: options.cwd, env: sanitizeEnv(process.env), detached: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const append = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString();
      return next.length > limit ? next.slice(0, limit) + '\n[truncated]' : next;
    };
    const killTree = (signal: NodeJS.Signals) => {
      try { if (child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already exited */ }
    };
    const settle = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      killTimer = setTimeout(() => killTree('SIGKILL'), 2_000);
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    // Without this, a spawn failure (ENOENT/EAGAIN) emits 'error', 'close' may never
    // fire, and the Promise would hang forever while the error goes unhandled.
    child.on('error', (err: Error) => { settle({ exitCode: -1, stdout, stderr: stderr || err.message, timedOut }); });
    child.on('close', (exitCode) => { settle({ exitCode: timedOut ? -1 : exitCode, stdout, stderr, timedOut }); });
  });
}

async function sandboxExecExists(): Promise<boolean> {
  try { await access('/usr/bin/sandbox-exec', constants.X_OK); return true; } catch { return false; }
}
