import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { Config } from '../config/schema.js';
import { createProvider } from '../llm/registry.js';
import { CODEX_MODELS } from '../llm/models.js';
import { loginWithCodexBrowser } from '../llm/providers/codex-login.js';
import { runTurn } from '../agent/loop.js';
import { createSession, loadSession } from '../session/store.js';
import type { Session } from '../session/types.js';
import { ALL_TOOLS } from '../tools/registry.js';
import { ApprovalModal } from './components/approval-modal.js';
import { InputBar } from './components/input-bar.js';
import { LoginProviders } from './components/login-providers.js';
import { ModelPicker } from './components/model-picker.js';
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
  const [session, setSession] = useState<Session | null>(null);
  const [activeModel, setActiveModel] = useState(model);
  const running = useRef(false);

  useEffect(() => {
    void (async () => setSession(sessionId ? await loadSession(workspaceRoot, sessionId) : await createSession(workspaceRoot, providerId, model)))();
  }, [workspaceRoot, providerId, model, sessionId]);

  const startCodexLogin = useCallback(() => {
    if (running.current) return;
    running.current = true;
    dispatch({ type: 'set-disabled', disabled: true });
    dispatch({ type: 'add-message', message: { role: 'assistant', content: 'Opening Codex login in your browser...' } });

    void loginWithCodexBrowser({ credentialsPath: config.providers.codex?.oauthCredentialsPath, sourceCredentialsPath: config.providers.codex?.oauthSourceCredentialsPath })
      .then((credentialsPath) => {
        dispatch({ type: 'add-message', message: { role: 'assistant', content: `Codex login complete. Credentials saved at ${credentialsPath}.` } });
        dispatch({ type: 'set-screen', screen: 'chat' });
      })
      .catch((error: unknown) => {
        dispatch({ type: 'add-message', message: { role: 'assistant', content: `Codex login failed: ${error instanceof Error ? error.message : String(error)}` } });
      })
      .finally(() => {
        dispatch({ type: 'set-disabled', disabled: false });
        running.current = false;
      });
  }, [config.providers.codex?.oauthCredentialsPath, config.providers.codex?.oauthSourceCredentialsPath, dispatch]);

  const submit = useCallback((message: string) => {
    if (message === '/login') {
      dispatch({ type: 'set-screen', screen: 'login' });
      return;
    }
    if (message.startsWith('/models')) {
      const requestedModel = message.split(/\s+/)[1];
      if (requestedModel) {
        const option = CODEX_MODELS.find((candidate) => candidate.id === requestedModel);
        if (option) {
          setActiveModel(option.id);
          setSession((current) => current ? { ...current, model: option.id } : current);
          dispatch({ type: 'add-message', message: { role: 'assistant', content: `Model changed to ${option.id}.` } });
        } else {
          dispatch({ type: 'add-message', message: { role: 'assistant', content: `Unknown Codex model: ${requestedModel}. Type /models to choose one.` } });
        }
        return;
      }
      dispatch({ type: 'set-screen', screen: 'models' });
      return;
    }
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
        config: { permissions: config.permissions },
        userMessage: message,
        onEvent(event) {
          if (event.type === 'content') dispatch({ type: 'content', text: event.text });
          if (event.type === 'tool-start') dispatch({ type: 'tool-start', id: event.toolCallId, name: event.name, input: event.input });
          if (event.type === 'tool-done') dispatch({ type: 'tool-done', id: event.toolCallId, output: event.result.output || event.result.error || '', ok: event.result.ok });
          if (event.type === 'approval-request') dispatch({ type: 'approval', request: event });
          if (event.type === 'question') dispatch({ type: 'question', question: event });
          if (event.type === 'error') dispatch({ type: 'add-message', message: { role: 'assistant', content: `Error: ${event.message}` } });
          if (event.type === 'done') {
            dispatch({ type: 'flush-stream' });
            dispatch({ type: 'set-disabled', disabled: false });
            running.current = false;
          }
        },
      });
    })().catch((error: unknown) => {
      dispatch({ type: 'add-message', message: { role: 'assistant', content: `Error: ${error instanceof Error ? error.message : String(error)}` } });
      dispatch({ type: 'set-disabled', disabled: false });
      running.current = false;
    });
  }, [session, config, providerId, dispatch]);

  return (
    <Box flexDirection="column" width="100%" minHeight={24} borderStyle="round" paddingX={1}>
      <Box justifyContent="space-between">
        <Text inverse> harness {session?.id ?? 'loading'} </Text>
        <Text dimColor>{providerId}/{activeModel}</Text>
      </Box>
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
              setActiveModel(selectedModel);
              setSession((current) => current ? { ...current, model: selectedModel } : current);
              dispatch({ type: 'add-message', message: { role: 'assistant', content: `Model changed to ${selectedModel}.` } });
              dispatch({ type: 'set-screen', screen: 'chat' });
            }}
          />
        )}
        {state.toolCards.map((card) => <ToolCard key={card.id} card={card} />)}
        <ApprovalModal />
      </Box>
      <InputBar onSubmit={submit} />
    </Box>
  );
}
