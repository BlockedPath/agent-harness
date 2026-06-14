import { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { useTuiStore } from '../store.js';
import { COMMANDS } from '../commands.js';

const SLASH_COMMANDS = COMMANDS.map((command) => ({ name: command.name, description: command.summary }));

export function InputBar({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const { exit } = useApp();
  const { state, dispatch } = useTuiStore();
  const commandPreview = value.startsWith('/')
    ? SLASH_COMMANDS.filter((command) => command.name.startsWith(value))
    : [];

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [value]);

  useEffect(() => {
    if (selectedCommandIndex >= commandPreview.length) setSelectedCommandIndex(Math.max(0, commandPreview.length - 1));
  }, [commandPreview.length, selectedCommandIndex]);

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
    if (commandPreview.length > 0 && key.upArrow) {
      setSelectedCommandIndex((current) => (current - 1 + commandPreview.length) % commandPreview.length);
      return;
    }
    if (commandPreview.length > 0 && key.downArrow) {
      setSelectedCommandIndex((current) => (current + 1) % commandPreview.length);
      return;
    }
    const selectedCommand = commandPreview[selectedCommandIndex];
    if (commandPreview.length > 0 && key.tab && selectedCommand) {
      setValue(selectedCommand.name);
      return;
    }
    if (key.return && value.trim()) {
      onSubmit(commandPreview.length > 0 && selectedCommand ? selectedCommand.name : value.trim());
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
          {commandPreview.map((command, index) => (
            <Text key={command.name}>
              <Text color="green" inverse={index === selectedCommandIndex}>{command.name}</Text>
              <Text dimColor={index !== selectedCommandIndex}> - {command.description}</Text>
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
