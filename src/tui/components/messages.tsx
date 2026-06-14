import React from 'react';
import { Box, Text } from 'ink';
import { useTuiStore } from '../store.js';

export function Messages() {
  const { state } = useTuiStore();

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={10}>
      {state.messages.slice(-200).map((message, index) => (
        <Text key={index} color={message.role === 'user' ? 'cyan' : message.role === 'assistant' ? 'white' : 'gray'}>
          {message.role}: {message.content}
        </Text>
      ))}
      {state.streamingText ? <Text color="white">assistant: {state.streamingText}</Text> : null}
    </Box>
  );
}
