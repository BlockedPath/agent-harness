import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { useTuiStore } from '../store.js';

interface SlashCommand {
  name: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/login', description: 'Sign in to a provider with browser OAuth.' },
  { name: '/models', description: 'Choose the active Codex model.' },
];

export function InputBar({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('');
  const { exit } = useApp();
  const { state, dispatch } = useTuiStore();
  const commandPreview = value.startsWith('/') ? SLASH_COMMANDS.filter((command) => command.name.startsWith(value)) : [];

  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
    if (state.approvalRequest && (input === 'y' || input === 'n')) {
      state.approvalRequest.resolve(input === 'y');
      dispatch({ type: 'approval', request: null });
      return;
    }
    if (state.question && key.return) {
      state.question.resolve(value);
      dispatch({ type: 'question', question: null });
      setValue('');
      return;
    }
    if (state.inputDisabled) return;
    if (key.return && value.trim()) {
      onSubmit(value.trim());
      setValue('');
      return;
    }
    if (key.backspace || key.delete) setValue((current) => current.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) setValue((current) => current + input);
  });

  return (
    <Box flexDirection="column">
      {commandPreview.length > 0 ? (
        <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
          {commandPreview.map((command) => (
            <Text key={command.name}>
              <Text color="green">{command.name}</Text>
              <Text dimColor> - {command.description}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
      <Box borderStyle="single" paddingX={1} minHeight={3}>
        <Text color="green">{state.question ? state.question.question : '>'} </Text>
        <Text>{value}</Text>
      </Box>
    </Box>
  );
}
