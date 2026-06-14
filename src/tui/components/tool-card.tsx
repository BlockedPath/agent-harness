import React from 'react';
import { Box, Text } from 'ink';
import type { ToolCardState } from '../store.js';
import { DiffView } from './diff-view.js';

export function ToolCard({ card }: { card: ToolCardState }) {
  return <Box borderStyle="round" flexDirection="column" paddingX={1}><Text color="yellow">tool {card.name} [{card.status}]</Text><Text color="gray">{JSON.stringify(card.input)}</Text>{card.output ? <Text>{card.output}</Text> : null}<DiffView diff={card.diff} /></Box>;
}
