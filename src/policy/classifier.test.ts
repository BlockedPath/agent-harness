import { describe, expect, it } from 'vitest';
import { classifyCommand } from './classifier.js';

describe('classifyCommand', () => {
  it('classifies dangerous commands', () => { expect(classifyCommand('rm -rf /')).toBe('dangerous'); });
  it('classifies network commands', () => { expect(classifyCommand('npm install')).toBe('network'); });
  it('classifies normal commands as execute', () => { expect(classifyCommand('go test ./...')).toBe('execute'); });
});
