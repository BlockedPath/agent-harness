import React, { createContext, useContext, useReducer } from 'react';
import type { ChatMessage } from '../llm/types.js';

export interface ToolCardState {
  id: string;
  name: string;
  input: unknown;
  status: 'pending' | 'running' | 'done' | 'error';
  output?: string;
  diff?: string;
}

export interface ApprovalState {
  toolCallId: string;
  name: string;
  diff?: string;
  resolve: (approved: boolean) => void;
}

export type TuiScreen = 'chat' | 'login' | 'models' | 'sessions';

export type ErrorSeverity = 'provider' | 'tool' | 'approval';
export interface ErrorMessage {
  role: 'error';
  severity: ErrorSeverity;
  content: string;
}
export type DisplayMessage = ChatMessage | ErrorMessage;

export interface TuiState {
  messages: DisplayMessage[];
  toolCards: ToolCardState[];
  approvalRequest: ApprovalState | null;
  streamingText: string;
  inputDisabled: boolean;
  question: { question: string; resolve: (answer: string) => void } | null;
  screen: TuiScreen;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

type Action =
  | { type: 'add-message'; message: ChatMessage }
  | { type: 'add-error'; severity: ErrorSeverity; content: string }
  | { type: 'content'; text: string }
  | { type: 'tool-call-delta'; id: string; name: string; partialArgs: string }
  | { type: 'tool-start'; id: string; name: string; input: unknown }
  | { type: 'tool-done'; id: string; output: string; ok: boolean }
  | { type: 'approval'; request: ApprovalState | null }
  | { type: 'question'; question: TuiState['question'] }
  | { type: 'set-disabled'; disabled: boolean }
  | { type: 'set-screen'; screen: TuiScreen }
  | { type: 'usage'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'reset' }
  | { type: 'flush-stream' };

export const initialState: TuiState = {
  messages: [],
  toolCards: [],
  approvalRequest: null,
  streamingText: '',
  inputDisabled: false,
  question: null,
  screen: 'chat',
  usage: null,
};

const Context = createContext<{ state: TuiState; dispatch: React.Dispatch<Action> } | null>(null);

export function TuiStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <Context.Provider value={{ state, dispatch }}>{children}</Context.Provider>;
}

export function useTuiStore() {
  const value = useContext(Context);
  if (!value) throw new Error('useTuiStore must be used inside TuiStoreProvider');
  return value;
}

export function reducer(state: TuiState, action: Action): TuiState {
  switch (action.type) {
    case 'add-message':
      return { ...state, messages: [...state.messages, action.message].slice(-200) };
    case 'add-error':
      return { ...state, messages: [...state.messages, { role: 'error' as const, severity: action.severity, content: action.content }].slice(-200) };
    case 'content':
      return { ...state, streamingText: state.streamingText + action.text };
    case 'tool-call-delta': {
      // Live streaming of a tool call's arguments BEFORE it runs. `partialArgs`
      // is cumulative (the full text so far for this call), so we REPLACE rather
      // than append. Never downgrade a card that has already advanced to
      // running/done/error (the agent loop may emit a trailing delta).
      const existing = state.toolCards.find((c) => c.id === action.id);
      if (existing) {
        return { ...state, toolCards: state.toolCards.map((c) => c.id === action.id ? { ...c, name: action.name, input: action.partialArgs } : c) };
      }
      return { ...state, toolCards: [...state.toolCards, { id: action.id, name: action.name, input: action.partialArgs, status: 'pending' }] };
    }
    case 'tool-start': {
      // Upsert: a pending card from `tool-call-delta` may already exist for this
      // id. Promote it to running with the parsed input instead of appending a
      // duplicate card.
      const existing = state.toolCards.find((c) => c.id === action.id);
      if (existing) {
        return { ...state, toolCards: state.toolCards.map((c) => c.id === action.id ? { ...c, name: action.name, input: action.input, status: 'running' } : c) };
      }
      return { ...state, toolCards: [...state.toolCards, { id: action.id, name: action.name, input: action.input, status: 'running' }] };
    }
    case 'tool-done':
      return { ...state, toolCards: state.toolCards.map((card) => card.id === action.id ? { ...card, status: action.ok ? 'done' : 'error', output: action.output } : card) };
    case 'approval':
      return { ...state, approvalRequest: action.request };
    case 'question':
      return { ...state, question: action.question };
    case 'set-disabled':
      return { ...state, inputDisabled: action.disabled };
    case 'set-screen':
      return { ...state, screen: action.screen };
    case 'usage':
      return {
        ...state,
        usage: {
          promptTokens: (state.usage?.promptTokens ?? 0) + action.usage.promptTokens,
          completionTokens: (state.usage?.completionTokens ?? 0) + action.usage.completionTokens,
          totalTokens: (state.usage?.totalTokens ?? 0) + action.usage.totalTokens,
        },
      };
    case 'reset':
      return { ...initialState };
    case 'flush-stream':
      return state.streamingText ? { ...state, messages: [...state.messages, { role: 'assistant' as const, content: state.streamingText }].slice(-200), streamingText: '' } : state;
  }
}
