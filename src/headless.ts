import type { Config } from './config/schema.js';
import { runTurn } from './agent/loop.js';
import { createProvider } from './llm/registry.js';
import type { LlmProvider } from './llm/types.js';
import { createSession, loadSession } from './session/store.js';
import { ALL_TOOLS } from './tools/registry.js';

export interface RunHeadlessOptions {
  workspaceRoot: string;
  config: Config;
  providerId: string;
  model: string;
  prompt: string;
  sessionId?: string;
  /** Approve every tool that would otherwise prompt. Without it, such tools are denied. */
  autoApprove?: boolean;
  /** Assistant text sink. Defaults to stdout. */
  write?: (text: string) => void;
  /** Tool activity and diagnostics sink. Defaults to stderr. */
  writeErr?: (text: string) => void;
  /** Provider override; defaults to building one from config. Used for testing. */
  provider?: LlmProvider;
}

/**
 * Run a single agent turn without the TUI and stream the assistant's reply to
 * stdout. Tool activity and errors go to stderr so stdout stays pipe-friendly.
 * Throws if the agent reports an error so callers can surface a non-zero exit.
 */
export async function runHeadless(options: RunHeadlessOptions): Promise<void> {
  const write = options.write ?? ((text: string) => void process.stdout.write(text));
  const writeErr = options.writeErr ?? ((text: string) => void process.stderr.write(text));

  const session = options.sessionId
    ? await loadSession(options.workspaceRoot, options.sessionId)
    : await createSession(options.workspaceRoot, options.providerId, options.model);
  const provider = options.provider ?? await createProvider({ ...options.config, defaultProvider: options.providerId });

  let errorMessage: string | null = null;
  let wroteContent = false;

  await runTurn({
    session,
    provider,
    tools: ALL_TOOLS,
    config: { permissions: options.config.permissions },
    userMessage: options.prompt,
    onEvent(event) {
      switch (event.type) {
        case 'content':
          if (event.text) { write(event.text); wroteContent = true; }
          break;
        case 'tool-start':
          writeErr(`\n[tool] ${event.name} ${JSON.stringify(event.input)}\n`);
          break;
        case 'tool-done':
          writeErr(`[tool] ${event.result.ok ? 'ok' : `error: ${event.result.error ?? 'failed'}`}\n`);
          break;
        case 'approval-request':
          if (options.autoApprove) {
            event.resolve(true);
          } else {
            writeErr(`[denied] ${event.name} requires approval; rerun with --yes to allow.\n`);
            event.resolve(false);
          }
          break;
        case 'question':
          writeErr(`[skipped] agent asked "${event.question}" but no input is available in non-interactive mode.\n`);
          event.resolve('No answer available; running non-interactively.');
          break;
        case 'error':
          errorMessage = event.message;
          break;
        case 'done':
          if (wroteContent) write('\n');
          break;
      }
    },
  });

  if (errorMessage) throw new Error(errorMessage);
}
