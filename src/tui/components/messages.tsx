import { Box, Text } from 'ink';
import { useTuiStore } from '../store.js';

const ERROR_LABELS: Record<string, string> = {
  provider: '✖ provider error',
  tool: '✖ tool error',
  approval: '⊘ approval',
};

export function Messages() {
  const { state } = useTuiStore();

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={10}>
      {state.messages.slice(-200).map((message, index) => {
        if (message.role === 'error') {
          return (
            <Text key={index} color={message.severity === 'approval' ? 'yellow' : 'red'}>
              {ERROR_LABELS[message.severity] ?? '✖ error'}: {message.content}
            </Text>
          );
        }
        return (
          <Text key={index} color={message.role === 'user' ? 'cyan' : message.role === 'assistant' ? 'white' : 'gray'}>
            {message.role}: {message.content}
          </Text>
        );
      })}
      {state.streamingText ? <Text color="white">assistant: {state.streamingText}</Text> : null}
    </Box>
  );
}
