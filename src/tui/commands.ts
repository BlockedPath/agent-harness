import type { ModelOption } from '../llm/models.js';

/**
 * Result of interpreting a line submitted in the input bar. Kept free of React
 * and side effects so command handling can be unit tested in isolation.
 */
export type CommandAction =
  | { kind: 'open-screen'; screen: 'login' | 'models' }
  | { kind: 'set-model'; model: string; notice: string }
  | { kind: 'notice'; notice: string }
  | { kind: 'clear' }
  | { kind: 'exit' }
  | { kind: 'prompt'; text: string };

interface CommandSpec {
  name: string;
  aliases?: string[];
  summary: string;
}

/** Built-in slash commands, used both for dispatch help and the /help listing. */
export const COMMANDS: CommandSpec[] = [
  { name: '/help', summary: 'List available commands.' },
  { name: '/login', summary: 'Open provider login choices.' },
  { name: '/models', aliases: ['/model'], summary: 'Open the model picker, or pass an id to switch directly.' },
  { name: '/clear', aliases: ['/new'], summary: 'Start a fresh session and clear the screen.' },
  { name: '/exit', aliases: ['/quit'], summary: 'Exit the harness.' },
];

export const HELP_TEXT = ['Available commands:', ...COMMANDS.map((command) => {
  const names = [command.name, ...(command.aliases ?? [])].join(', ');
  return `  ${names.padEnd(20)} ${command.summary}`;
})].join('\n');

function matches(trimmed: string, command: CommandSpec | undefined): boolean {
  if (!command) return false;
  const names = [command.name, ...(command.aliases ?? [])];
  return names.some((name) => trimmed === name || trimmed.startsWith(`${name} `));
}

export function parseCommand(input: string, models: ModelOption[]): CommandAction {
  const trimmed = input.trim();

  if (matches(trimmed, COMMANDS[0])) return { kind: 'notice', notice: HELP_TEXT };
  if (matches(trimmed, COMMANDS[1])) return { kind: 'open-screen', screen: 'login' };

  if (matches(trimmed, COMMANDS[2])) {
    const requested = trimmed.split(/\s+/)[1];
    if (!requested) return { kind: 'open-screen', screen: 'models' };
    const option = models.find((candidate) => candidate.id === requested);
    if (option) return { kind: 'set-model', model: option.id, notice: `Model changed to ${option.id}.` };
    return { kind: 'notice', notice: `Unknown model: ${requested}. Type /models to choose one.` };
  }

  if (matches(trimmed, COMMANDS[3])) return { kind: 'clear' };
  if (matches(trimmed, COMMANDS[4])) return { kind: 'exit' };

  if (trimmed.startsWith('/')) {
    return { kind: 'notice', notice: `Unknown command: ${trimmed.split(/\s+/)[0]}. Type /help for a list.` };
  }

  return { kind: 'prompt', text: input };
}
