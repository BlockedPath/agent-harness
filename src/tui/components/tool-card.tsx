import { Box, Text } from 'ink';
import type { ToolCardState } from '../store.js';
import { DiffView } from './diff-view.js';

const STATUS_COLOR: Record<ToolCardState['status'], string> = {
  pending: 'yellow',
  running: 'yellow',
  done: 'green',
  error: 'red',
};

export function ToolCard({ card }: { card: ToolCardState }) {
  const isError = card.status === 'error';
  const isPending = card.status === 'pending';
  const borderColor = isError ? 'red' : undefined;
  // `input` is a raw (possibly incomplete) string while pending, and a parsed
  // object once running/done/error. Render each shape without crashing.
  const inputText = isPending && typeof card.input === 'string'
    ? card.input
    : JSON.stringify(card.input);
  return (
    <Box borderStyle="round" borderColor={borderColor} flexDirection="column" paddingX={1}>
      <Text color={STATUS_COLOR[card.status]}>{isError ? '✖ ' : ''}tool {card.name} [{card.status}]{isPending ? ' (args streaming…)' : ''}</Text>
      <Text color="gray">{inputText}</Text>
      {card.output ? <Text color={isError ? 'red' : undefined}>{card.output}</Text> : null}
      <DiffView diff={card.diff} />
    </Box>
  );
}
