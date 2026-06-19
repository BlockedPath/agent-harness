import fs from 'node:fs';
import path from 'node:path';
import type React from 'react';
import { Command } from 'commander';
import { loadConfig } from './config/loader.js';
import { runHeadless } from './headless.js';
import { App } from './tui/app.js';

export interface CreateCliProgramOptions {
  cwd?: string;
  renderApp: (element: React.ReactElement) => unknown;
  runHeadless?: typeof runHeadless;
}

interface CliOptions {
  provider?: string;
  model?: string;
  session?: string;
  config?: string;
  print?: string;
  yes?: boolean;
  json?: boolean;
}

export function createCliProgram({ cwd = process.cwd(), renderApp, runHeadless: runHeadlessImpl = runHeadless }: CreateCliProgramOptions): Command {
  const program = new Command();
  program
    .name('harness')
    .argument('[workspace]', 'workspace directory', cwd)
    .option('--provider <id>', 'provider id')
    .option('--model <model>', 'model name')
    .option('--session <id>', 'session id')
    .option('--config <path>', 'config file path')
    .option('-p, --print <prompt>', 'run a single prompt non-interactively and print the result')
    .option('-y, --yes', 'auto-approve tools that would otherwise prompt (only with --print)')
    .option('--json', 'with --print, emit a single JSON result object to stdout')
    .action(async (workspaceArg: string, options: CliOptions) => {
      const workspaceRoot = path.resolve(workspaceArg);
      if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) throw new Error(`Workspace is not a directory: ${workspaceRoot}`);
      const config = await loadConfig(workspaceRoot, options.config ? path.resolve(options.config) : undefined);
      const providerId = options.provider ?? config.defaultProvider;
      const model = options.model ?? config.defaultModel;
      if (options.print !== undefined) {
        await runHeadlessImpl({ workspaceRoot, config, providerId, model, prompt: options.print, sessionId: options.session, autoApprove: options.yes, json: options.json });
        return;
      }
      renderApp(<App workspaceRoot={workspaceRoot} config={config} providerId={providerId} model={model} sessionId={options.session} />);
    });
  return program;
}
