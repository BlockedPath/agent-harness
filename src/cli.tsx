#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import dotenv from 'dotenv';
import { loadConfig } from './config/loader.js';
import { App } from './tui/app.js';

dotenv.config();

const program = new Command();
program
  .name('harness')
  .argument('[workspace]', 'workspace directory', process.cwd())
  .option('--provider <id>', 'provider id')
  .option('--model <model>', 'model name')
  .option('--session <id>', 'session id')
  .option('--config <path>', 'config file path')
  .action(async (workspaceArg: string, options: { provider?: string; model?: string; session?: string; config?: string }) => {
    const workspaceRoot = path.resolve(workspaceArg);
    if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) throw new Error(`Workspace is not a directory: ${workspaceRoot}`);
    const config = await loadConfig(workspaceRoot, options.config ? path.resolve(options.config) : undefined);
    const providerId = options.provider ?? config.defaultProvider;
    const model = options.model ?? config.defaultModel;
    render(<App workspaceRoot={workspaceRoot} config={config} providerId={providerId} model={model} sessionId={options.session} />);
  });

await program.parseAsync(process.argv);
