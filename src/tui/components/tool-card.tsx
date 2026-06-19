import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { ToolCardState } from '../store.js';
import { DiffView } from './diff-view.js';
import { Spinner } from './spinner.js';

const STATUS_COLOR: Record<ToolCardState['status'], string> = {
  pending: 'yellow',
  running: 'yellow',
  done: 'green',
  error: 'red',
};

export function ToolCard({ card }: { card: ToolCardState }) {
  const isError = card.status === 'error';
  const isPending = card.status === 'pending';
  const isRunning = card.status === 'running';
  const borderColor = isError ? 'red' : undefined;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning || card.startedAt == null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [isRunning, card.startedAt]);

  const elapsedSec = isRunning && card.startedAt != null ? Math.max(0, Math.floor((now - card.startedAt) / 1000)) : null;
  // `input` is a raw (possibly incomplete) string while pending, and a parsed
  // object once running/done/error. Render each shape without crashing.
  const inputText = isPending && typeof card.input === 'string'
    ? card.input
    : JSON.stringify(card.input);
  return (
    <Box borderStyle="round" borderColor={borderColor} flexDirection="column" paddingX={1}>
      <Text color={STATUS_COLOR[card.status]}>
        {isError ? '✖ ' : ''}
        {isRunning ? <><Spinner color={STATUS_COLOR.running} /> </> : null}
        tool {card.name} [{card.status}]{elapsedSec == null ? '' : ` ${elapsedSec}s`}{isPending ? ' (args streaming…)' : ''}
      </Text>
      <Text color="gray">{inputText}</Text>
      {card.output ? <Text color={isError ? 'red' : undefined}>{card.output}</Text> : null}
      <DiffView diff={card.diff} />
    </Box>
  );
}
