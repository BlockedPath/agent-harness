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
  const borderColor = isError ? 'red' : undefined;
  return (
    <Box borderStyle="round" borderColor={borderColor} flexDirection="column" paddingX={1}>
      <Text color={STATUS_COLOR[card.status]}>{isError ? '✖ ' : ''}tool {card.name} [{card.status}]</Text>
      <Text color="gray">{JSON.stringify(card.input)}</Text>
      {card.output ? <Text color={isError ? 'red' : undefined}>{card.output}</Text> : null}
      <DiffView diff={card.diff} />
    </Box>
  );
}
