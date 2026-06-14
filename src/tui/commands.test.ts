import { describe, expect, it } from 'vitest';
import { CODEX_MODELS } from '../llm/models.js';
import { HELP_TEXT, parseCommand } from './commands.js';

describe('parseCommand', () => {
  it('opens the login screen for /login', () => {
    expect(parseCommand('/login', CODEX_MODELS)).toEqual({ kind: 'open-screen', screen: 'login' });
  });

  it('opens the models screen for a bare /models', () => {
    expect(parseCommand('/models', CODEX_MODELS)).toEqual({ kind: 'open-screen', screen: 'models' });
  });

  it('accepts /model as an alias for /models', () => {
    expect(parseCommand('/model', CODEX_MODELS)).toEqual({ kind: 'open-screen', screen: 'models' });
  });

  it('selects a known model passed inline to /models', () => {
    const model = CODEX_MODELS[1]!.id;
    expect(parseCommand(`/models ${model}`, CODEX_MODELS)).toEqual({
      kind: 'set-model',
      model,
      notice: `Model changed to ${model}.`,
    });
  });

  it('returns a notice for an unknown inline model', () => {
    expect(parseCommand('/models gpt-nope', CODEX_MODELS)).toEqual({
      kind: 'notice',
      notice: 'Unknown model: gpt-nope. Type /models to choose one.',
    });
  });

  it('returns the help listing for /help', () => {
    expect(parseCommand('/help', CODEX_MODELS)).toEqual({ kind: 'notice', notice: HELP_TEXT });
    expect(HELP_TEXT).toContain('/clear');
    expect(HELP_TEXT).toContain('/exit');
  });

  it('clears the session for /clear and its /new alias', () => {
    expect(parseCommand('/clear', CODEX_MODELS)).toEqual({ kind: 'clear' });
    expect(parseCommand('/new', CODEX_MODELS)).toEqual({ kind: 'clear' });
  });

  it('exits for /exit and its /quit alias', () => {
    expect(parseCommand('/exit', CODEX_MODELS)).toEqual({ kind: 'exit' });
    expect(parseCommand('/quit', CODEX_MODELS)).toEqual({ kind: 'exit' });
  });

  it('treats non-command input as a prompt, preserving original text', () => {
    expect(parseCommand('  fix the bug ', CODEX_MODELS)).toEqual({ kind: 'prompt', text: '  fix the bug ' });
  });

  it('flags an unrecognized slash command instead of sending it to the model', () => {
    expect(parseCommand('/bogus now', CODEX_MODELS)).toEqual({
      kind: 'notice',
      notice: 'Unknown command: /bogus. Type /help for a list.',
    });
  });
});
