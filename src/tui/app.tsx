import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import type { Config } from '../config/schema.js';
import { createProvider } from '../llm/registry.js';
import { CODEX_MODELS } from '../llm/models.js';
import { loginWithCodexBrowser } from '../llm/providers/codex-login.js';
import { CodexAuthError } from '../llm/providers/codex-oauth.js';
import { runTurn } from '../agent/loop.js';
import { compactSession, DEFAULT_COMPACTION } from '../agent/compaction.js';
import { createSession, listSessionSummaries, loadSession, setSessionModel, type SessionSummary } from '../session/store.js';
import { parseCommand } from './commands.js';
import type { Session } from '../session/types.js';
import { ALL_TOOLS } from '../tools/registry.js';
import { ApprovalModal } from './components/approval-modal.js';
import { InputBar } from './components/input-bar.js';
import { LoginProviders } from './components/login-providers.js';
import { ModelPicker } from './components/model-picker.js';
import { SessionPicker } from './components/session-picker.js';
import { Messages } from './components/messages.js';
import { ToolCard } from './components/tool-card.js';
import { TuiStoreProvider, useTuiStore } from './store.js';

export interface AppProps {
  workspaceRoot: string;
  config: Config;
  providerId: string;
  model: string;
  sessionId?: string;
}

export function App(props: AppProps) {
  return <TuiStoreProvider><AppInner {...props} /></TuiStoreProvider>;
}

function AppInner({ workspaceRoot, config, providerId, model, sessionId }: AppProps) {
  const { state, dispatch } = useTuiStore();
  const { exit } = useApp();
  const [session, setSession] = useState<Session | null>(null);
  const [activeModel, setActiveModel] = useState(model);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const running = useRef(false);
  const pendingRetry = useRef<string | null>(null);

  useEffect(() => {
    void (async () => setSession(sessionId ? await loadSession(workspaceRoot, sessionId) : await createSession(workspaceRoot, providerId, model)))();
  }, [workspaceRoot, providerId, model, sessionId]);

  const runAgentTurn = useCallback((message: string) => {
    if (!session || running.current) return;
    running.current = true;
    dispatch({ type: 'add-message', message: { role: 'user', content: message } });
    dispatch({ type: 'set-disabled', disabled: true });

    void (async () => {
      const provider = await createProvider({ ...config, defaultProvider: providerId });
      await runTurn({
        session,
        provider,
        tools: ALL_TOOLS,
        config: { permissions: config.permissions, compaction: config.compaction },
        userMessage: message,
        onEvent(event) {
          if (event.type === 'content') dispatch({ type: 'content', text: event.text });
          if (event.type === 'tool-call-delta') dispatch({ type: 'tool-call-delta', id: event.toolCallId, name: event.name, partialArgs: event.partialArgs });
          if (event.type === 'tool-start') dispatch({ type: 'tool-start', id: event.toolCallId, name: event.name, input: event.input });
          if (event.type === 'tool-done') dispatch({ type: 'tool-done', id: event.toolCallId, output: event.result.output || event.result.error || '', ok: event.result.ok });
          if (event.type === 'approval-request') dispatch({ type: 'approval', request: event });
          if (event.type === 'question') dispatch({ type: 'question', question: event });
          if (event.type === 'usage') dispatch({ type: 'usage', usage: event.usage });
          if (event.type === 'compaction') dispatch({ type: 'add-message', message: { role: 'assistant', content: `Auto-compacted ${event.droppedCount} earlier messages to free up context (kept ${event.keptCount} recent).` } });
          if (event.type === 'error') {
            dispatch({ type: 'add-error', severity: 'provider', content: event.message });
            dispatch({ type: 'set-disabled', disabled: false });
            running.current = false;
          }
          if (event.type === 'done') {
            dispatch({ type: 'flush-stream' });
            dispatch({ type: 'set-disabled', disabled: false });
            running.current = false;
          }
        },
      });
    })().catch((error: unknown) => {
      running.current = false;
      dispatch({ type: 'set-disabled', disabled: false });
      if (isAuthError(error)) {
        // Auth failed mid-turn: stash the message, surface the error, and guide
        // the user to re-login. The turn is retried automatically after sign-in.
        pendingRetry.current = message;
        dispatch({ type: 'add-error', severity: 'provider', content: error instanceof Error ? error.message : String(error) });
        dispatch({ type: 'add-message', message: { role: 'assistant', content: 'Sign in again to continue — choose a provider below. Your last message will be retried automatically.' } });
        dispatch({ type: 'set-screen', screen: 'login' });
      } else {
        dispatch({ type: 'add-error', severity: 'provider', content: error instanceof Error ? error.message : String(error) });
      }
    });
  }, [session, config, providerId, dispatch]);

  const startCodexLogin = useCallback(() => {
    if (running.current) return;
    running.current = true;
    dispatch({ type: 'set-disabled', disabled: true });
    dispatch({ type: 'add-message', message: { role: 'assistant', content: 'Opening Codex login in your browser...' } });

    void loginWithCodexBrowser({ credentialsPath: config.providers.codex?.oauthCredentialsPath, sourceCredentialsPath: config.providers.codex?.oauthSourceCredentialsPath })
      .then((credentialsPath) => {
        dispatch({ type: 'add-message', message: { role: 'assistant', content: `Codex login complete. Credentials saved at ${credentialsPath}.` } });
        dispatch({ type: 'set-screen', screen: 'chat' });
        dispatch({ type: 'set-disabled', disabled: false });
        running.current = false;
        const retry = pendingRetry.current;
        pendingRetry.current = null;
        if (retry) {
          dispatch({ type: 'add-message', message: { role: 'assistant', content: 'Re-authenticated. Retrying your last message…' } });
          runAgentTurn(retry);
        }
      })
      .catch((error: unknown) => {
        dispatch({ type: 'add-error', severity: 'provider', content: `Codex login failed: ${error instanceof Error ? error.message : String(error)}` });
        dispatch({ type: 'set-disabled', disabled: false });
        running.current = false;
      });
  }, [config.providers.codex?.oauthCredentialsPath, config.providers.codex?.oauthSourceCredentialsPath, dispatch, runAgentTurn]);

  const compactNow = useCallback(() => {
    if (!session || running.current) return;
    running.current = true;
    dispatch({ type: 'set-disabled', disabled: true });
    dispatch({ type: 'add-message', message: { role: 'assistant', content: 'Compacting conversation…' } });

    void (async () => {
      const provider = await createProvider({ ...config, defaultProvider: providerId });
      const result = await compactSession({ session, provider, keepRecent: config.compaction?.keepRecent ?? DEFAULT_COMPACTION.keepRecent });
      dispatch({ type: 'add-message', message: { role: 'assistant', content: result ? `Compacted ${result.droppedCount} messages into a summary (kept ${result.keptCount} recent).` : 'Nothing to compact yet — the history is already short.' } });
    })().catch((error: unknown) => {
      dispatch({ type: 'add-error', severity: 'provider', content: `Compaction failed: ${error instanceof Error ? error.message : String(error)}` });
    }).finally(() => {
      dispatch({ type: 'set-disabled', disabled: false });
      running.current = false;
    });
  }, [session, config, providerId, dispatch]);

  const applyModelChange = useCallback((newModel: string, notice: string) => {
    setActiveModel(newModel);
    setSession((current) => {
      if (!current) return current;
      void setSessionModel(current.workspaceRoot, current.id, newModel);
      return { ...current, model: newModel };
    });
    dispatch({ type: 'add-message', message: { role: 'assistant', content: notice } });
  }, [dispatch]);

  const resumeSession = useCallback((id: string) => {
    void (async () => {
      const loaded = await loadSession(workspaceRoot, id);
      dispatch({ type: 'reset' });
      setSession(loaded);
      setActiveModel(loaded.model);
      for (const message of loaded.messages) dispatch({ type: 'add-message', message });
      dispatch({ type: 'add-message', message: { role: 'assistant', content: `Resumed session ${loaded.id} (${loaded.messages.length} messages).` } });
    })().catch((error: unknown) => {
      dispatch({ type: 'set-screen', screen: 'chat' });
      dispatch({ type: 'add-error', severity: 'provider', content: `Could not resume session: ${error instanceof Error ? error.message : String(error)}` });
    });
  }, [workspaceRoot, dispatch]);

  const submit = useCallback((message: string) => {
    const action = parseCommand(message, CODEX_MODELS);
    if (action.kind === 'open-screen') {
      if (action.screen === 'sessions') {
        void listSessionSummaries(workspaceRoot).then((summaries) => {
          setSessions(summaries);
          dispatch({ type: 'set-screen', screen: 'sessions' });
        });
      } else {
        dispatch({ type: 'set-screen', screen: action.screen });
      }
      return;
    }
    if (action.kind === 'notice') {
      dispatch({ type: 'add-message', message: { role: 'assistant', content: action.notice } });
      return;
    }
    if (action.kind === 'set-model') {
      applyModelChange(action.model, action.notice);
      return;
    }
    if (action.kind === 'exit') {
      exit();
      return;
    }
    if (action.kind === 'compact') {
      compactNow();
      return;
    }
    if (action.kind === 'clear') {
      if (running.current) return;
      dispatch({ type: 'reset' });
      void createSession(workspaceRoot, providerId, activeModel).then((fresh) => {
        setSession(fresh);
        dispatch({ type: 'add-message', message: { role: 'assistant', content: `Started a new session ${fresh.id}.` } });
      });
      return;
    }
    runAgentTurn(action.text);
  }, [dispatch, applyModelChange, exit, compactNow, runAgentTurn, workspaceRoot, providerId, activeModel]);

  return (
    <Box flexDirection="column" width="100%" minHeight={24} borderStyle="round" paddingX={1}>
      <Box flexDirection="column" flexGrow={1} minHeight={14} paddingY={1}>
        <Messages />
        {state.screen === 'login' && (
          <LoginProviders
            disabled={state.inputDisabled}
            onCancel={() => dispatch({ type: 'set-screen', screen: 'chat' })}
            onSelect={(selectedProvider) => {
              if (selectedProvider === 'codex') startCodexLogin();
            }}
          />
        )}
        {state.screen === 'models' && (
          <ModelPicker
            currentModel={activeModel}
            disabled={state.inputDisabled}
            models={CODEX_MODELS}
            onCancel={() => dispatch({ type: 'set-screen', screen: 'chat' })}
            onSelect={(selectedModel) => {
              applyModelChange(selectedModel, `Model changed to ${selectedModel}.`);
              dispatch({ type: 'set-screen', screen: 'chat' });
            }}
          />
        )}
        {state.screen === 'sessions' && (
          <SessionPicker
            disabled={state.inputDisabled}
            sessions={sessions}
            currentId={session?.id}
            onCancel={() => dispatch({ type: 'set-screen', screen: 'chat' })}
            onSelect={(id) => {
              dispatch({ type: 'set-screen', screen: 'chat' });
              resumeSession(id);
            }}
          />
        )}
        {state.toolCards.map((card) => <ToolCard key={card.id} card={card} />)}
        <ApprovalModal />
      </Box>
      <InputBar onSubmit={submit} />
      <Box justifyContent="space-between" paddingX={1}>
        <Text dimColor>{state.inputDisabled ? 'working…' : 'ready'}</Text>
        <Text dimColor>{providerId}/{activeModel}{state.usage ? ` · ${formatTokens(state.usage.totalTokens)} tok` : ''}</Text>
      </Box>
    </Box>
  );
}

function formatTokens(total: number): string {
  return total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
}

export function isAuthError(error: unknown): boolean {
  if (error instanceof CodexAuthError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /credential|sign in|log ?in|authenticat|token has been invalidated|missing .* token/i.test(message);
}
