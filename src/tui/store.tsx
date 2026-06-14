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

export type TuiScreen = 'chat' | 'login' | 'models';

export interface TuiState {
  messages: ChatMessage[];
  toolCards: ToolCardState[];
  approvalRequest: ApprovalState | null;
  streamingText: string;
  inputDisabled: boolean;
  question: { question: string; resolve: (answer: string) => void } | null;
  screen: TuiScreen;
}

type Action =
  | { type: 'add-message'; message: ChatMessage }
  | { type: 'content'; text: string }
  | { type: 'tool-start'; id: string; name: string; input: unknown }
  | { type: 'tool-done'; id: string; output: string; ok: boolean }
  | { type: 'approval'; request: ApprovalState | null }
  | { type: 'question'; question: TuiState['question'] }
  | { type: 'set-disabled'; disabled: boolean }
  | { type: 'set-screen'; screen: TuiScreen }
  | { type: 'flush-stream' };

const initialState: TuiState = {
  messages: [],
  toolCards: [],
  approvalRequest: null,
  streamingText: '',
  inputDisabled: false,
  question: null,
  screen: 'chat',
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

function reducer(state: TuiState, action: Action): TuiState {
  switch (action.type) {
    case 'add-message':
      return { ...state, messages: [...state.messages, action.message].slice(-200) };
    case 'content':
      return { ...state, streamingText: state.streamingText + action.text };
    case 'tool-start':
      return { ...state, toolCards: [...state.toolCards, { id: action.id, name: action.name, input: action.input, status: 'running' }] };
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
    case 'flush-stream':
      return state.streamingText ? { ...state, messages: [...state.messages, { role: 'assistant' as const, content: state.streamingText }].slice(-200), streamingText: '' } : state;
  }
}
