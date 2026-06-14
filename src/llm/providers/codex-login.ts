import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCodexAccessToken } from './codex-oauth.js';

export interface CodexLoginOptions {
  credentialsPath?: string;
  sourceCredentialsPath?: string;
  command?: string;
}

export async function loginWithCodexBrowser(options: CodexLoginOptions = {}): Promise<string> {
  const credentialsPath = expandHome(options.credentialsPath ?? '.harness/auth/codex.json');
  const sourceCredentialsPath = expandHome(options.sourceCredentialsPath ?? '~/.codex/auth.json');
  await runCodexLogout(options.command ?? 'codex');
  await runCodexLogin(options.command ?? 'codex');
  await copyVerifiedCredentials(sourceCredentialsPath, credentialsPath);
  return credentialsPath;
}

async function runCodexLogout(command: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(command, ['logout'], { stdio: 'ignore' });
    child.on('error', () => resolve());
    child.on('exit', () => resolve());
  });
}

async function runCodexLogin(command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ['login'], { stdio: 'inherit' });
    child.on('error', (error) => reject(new Error(`Unable to start Codex login. Is the Codex CLI installed? ${error.message}`)));
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ? `Codex login was interrupted by ${signal}.` : `Codex login failed with exit code ${code ?? 'unknown'}.`));
    });
  });
}

async function copyVerifiedCredentials(sourcePath: string, destinationPath: string): Promise<void> {
  let rawText: string;
  let raw: Record<string, unknown>;
  try {
    rawText = await fs.readFile(sourcePath, 'utf8');
    raw = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error(`Codex login completed, but credentials were not readable at ${sourcePath}.`);
  }
  if (!readCodexAccessToken(raw)) {
    throw new Error(`Codex login completed, but no access token was found in ${sourcePath}.`);
  }
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, `${JSON.stringify(raw, null, 2)}
`, { mode: 0o600 });
}

function expandHome(file: string): string {
  return file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file;
}
