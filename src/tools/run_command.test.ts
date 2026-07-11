import { describe, expect, it } from 'vitest';
import { modeForCommand } from './run_command.js';

describe('run_command sandbox mode selection', () => {
  it('uses the network sandbox for network commands', () => {
    expect(modeForCommand('npm install')).toBe('network');
    expect(modeForCommand('curl https://example.com')).toBe('network');
  });

  it('keeps dangerous commands as an explicit dangerous mode', () => {
    expect(modeForCommand('rm -rf ./tmp')).toBe('dangerous');
  });

  it('uses workspace-write for ordinary commands', () => {
    expect(modeForCommand('printf hello')).toBe('workspace-write');
  });
});
