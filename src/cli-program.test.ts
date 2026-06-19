import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type React from 'react';
import { describe, expect, it } from 'vitest';
import { createCliProgram } from './cli-program.js';

describe('createCliProgram', () => {
  it('starts the app with the resolved workspace and CLI overrides', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-cli-'));
    const configPath = path.join(workspaceRoot, 'harness.config.json');
    await fs.writeFile(configPath, JSON.stringify({
      defaultProvider: 'codex',
      defaultModel: 'gpt-5.5',
      providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } },
    }));

    const rendered: React.ReactElement[] = [];
    const program = createCliProgram({ cwd: workspaceRoot, renderApp: (element) => rendered.push(element) });

    await program.parseAsync(['node', 'harness', '--config', configPath, '--provider', 'openai', '--model', 'gpt-test', '--session', 'session-1'], { from: 'node' });

    expect(rendered).toHaveLength(1);
    const [firstRendered] = rendered;
    expect(firstRendered?.props).toMatchObject({
      workspaceRoot,
      providerId: 'openai',
      model: 'gpt-test',
      sessionId: 'session-1',
    });
  });

  it('runs headless instead of rendering when --print is passed', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-cli-'));
    const configPath = path.join(workspaceRoot, 'harness.config.json');
    await fs.writeFile(configPath, JSON.stringify({
      defaultProvider: 'codex',
      defaultModel: 'gpt-5.5',
      providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } },
    }));

    const rendered: React.ReactElement[] = [];
    const headlessCalls: unknown[] = [];
    const program = createCliProgram({
      cwd: workspaceRoot,
      renderApp: (element) => rendered.push(element),
      runHeadless: async (options) => { headlessCalls.push(options); },
    });

    await program.parseAsync(['node', 'harness', '--config', configPath, '--print', 'do the thing', '--yes'], { from: 'node' });

    expect(rendered).toHaveLength(0);
    expect(headlessCalls).toHaveLength(1);
    expect(headlessCalls[0]).toMatchObject({
      workspaceRoot,
      providerId: 'codex',
      model: 'gpt-5.5',
      prompt: 'do the thing',
      autoApprove: true,
    });
  });

  it('passes --json through to headless print runs', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-cli-'));
    const headlessCalls: unknown[] = [];
    const program = createCliProgram({
      cwd: workspaceRoot,
      renderApp: () => {},
      runHeadless: async (options) => { headlessCalls.push(options); },
    });

    await program.parseAsync(['node', 'harness', '--print', 'x', '--json'], { from: 'node' });

    expect(headlessCalls).toHaveLength(1);
    expect(headlessCalls[0]).toMatchObject({
      workspaceRoot,
      prompt: 'x',
      json: true,
    });
  });
});
