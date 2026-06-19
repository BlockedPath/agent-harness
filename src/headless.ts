import type { Config } from './config/schema.js';
import { runTurn } from './agent/loop.js';
import { createProvider } from './llm/registry.js';
import type { LlmProvider } from './llm/types.js';
import { createSession, loadSession } from './session/store.js';
import { ALL_TOOLS, filterTools } from './tools/registry.js';

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
  /** Emit one machine-readable JSON result line instead of streaming text/status. */
  json?: boolean;
}

/**
 * Run a single agent turn without the TUI and stream the assistant's reply to
 * stdout. Tool activity and errors go to stderr so stdout stays pipe-friendly.
 * Throws if the agent reports an error so callers can surface a non-zero exit.
 */
export async function runHeadless(options: RunHeadlessOptions): Promise<void> {
  const write = options.write ?? ((text: string) => void process.stdout.write(text));
  const writeErr = options.writeErr ?? ((text: string) => void process.stderr.write(text));

  if (options.json) {
    let session: Awaited<ReturnType<typeof createSession>> | null = null;
    let content = '';
    const toolCalls = new Map<string, { name: string; input: unknown; ok: boolean | null; output: string; error: string | null }>();
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;
    let errorMessage: string | null = null;

    try {
      session = options.sessionId
        ? await loadSession(options.workspaceRoot, options.sessionId)
        : await createSession(options.workspaceRoot, options.providerId, options.model);
      const provider = options.provider ?? await createProvider({ ...options.config, defaultProvider: options.providerId });

      await runTurn({
        session,
        provider,
        tools: filterTools(ALL_TOOLS, options.config.tools),
        config: { permissions: options.config.permissions, compaction: options.config.compaction },
        userMessage: options.prompt,
        onEvent(event) {
          switch (event.type) {
            case 'content':
              content += event.text;
              break;
            case 'tool-start':
              toolCalls.set(event.toolCallId, { name: event.name, input: event.input, ok: null, output: '', error: null });
              break;
            case 'tool-done': {
              const toolCall = toolCalls.get(event.toolCallId);
              if (toolCall) {
                toolCall.ok = event.result.ok;
                toolCall.output = event.result.output;
                toolCall.error = event.result.error ?? null;
              }
              break;
            }
            case 'approval-request':
              event.resolve(!!options.autoApprove);
              break;
            case 'question':
              event.resolve('No answer available; running non-interactively.');
              break;
            case 'usage':
              usage = usage
                ? {
                    promptTokens: usage.promptTokens + event.usage.promptTokens,
                    completionTokens: usage.completionTokens + event.usage.completionTokens,
                    totalTokens: usage.totalTokens + event.usage.totalTokens,
                  }
                : { ...event.usage };
              break;
            case 'error':
              errorMessage = event.message;
              break;
          }
        },
      });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    write(JSON.stringify({ ok: !errorMessage, sessionId: session?.id ?? options.sessionId ?? '', content, toolCalls: [...toolCalls.values()], usage, error: errorMessage }) + '\n');
    if (errorMessage) throw new Error(errorMessage);
    return;
  }

  const session = options.sessionId
    ? await loadSession(options.workspaceRoot, options.sessionId)
    : await createSession(options.workspaceRoot, options.providerId, options.model);
  const provider = options.provider ?? await createProvider({ ...options.config, defaultProvider: options.providerId });

  let errorMessage: string | null = null;
  let wroteContent = false;
  const announcedToolCalls = new Set<string>();

  await runTurn({
    session,
    provider,
    tools: filterTools(ALL_TOOLS, options.config.tools),
    config: { permissions: options.config.permissions, compaction: options.config.compaction },
    userMessage: options.prompt,
    onEvent(event) {
      switch (event.type) {
        case 'content':
          if (event.text) { write(event.text); wroteContent = true; }
          break;
        case 'tool-call-delta':
          if (event.name && !announcedToolCalls.has(event.toolCallId)) {
            announcedToolCalls.add(event.toolCallId);
            writeErr(`\n[tool→] ${event.name} (preparing…)\n`);
          }
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
        case 'usage':
          writeErr(`[usage] ${event.usage.totalTokens} tokens (${event.usage.promptTokens} in / ${event.usage.completionTokens} out)\n`);
          break;
        case 'compaction':
          writeErr(`[compaction] summarized ${event.droppedCount} earlier messages (kept ${event.keptCount} recent)\n`);
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
