import { describe, expect, it } from 'vitest';
import { classifyCommand } from './classifier.js';

describe('classifyCommand', () => {
  it('classifies dangerous commands', () => { expect(classifyCommand('rm -rf /')).toBe('dangerous'); });
  it('classifies network commands', () => { expect(classifyCommand('npm install')).toBe('network'); });
  it.each([
    'npm i zod', 'npx eslint .', 'pnpm add react', 'yarn dlx create-app',
    'pip3 install requests', 'git pull --rebase', 'cargo install ripgrep',
    'docker pull alpine', 'curl https://example.test/file', 'acme-pm install widget',
  ])('classifies package and network aliases as network: %s', (command) => {
    expect(classifyCommand(command)).toBe('network');
  });
  it('does not classify unrelated local commands as network', () => {
    expect(classifyCommand('npm test')).toBe('execute');
    expect(classifyCommand('git status')).toBe('execute');
    expect(classifyCommand('python script.py')).toBe('execute');
  });
  it('classifies normal commands as execute', () => { expect(classifyCommand('go test ./...')).toBe('execute'); });
});
