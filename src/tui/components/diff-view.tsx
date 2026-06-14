import React from 'react';
import { Text, Box } from 'ink';

export function DiffView({ diff }: { diff?: string }) {
  if (!diff) return null;
  return <Box flexDirection="column">{diff.split(/\r?\n/).slice(0, 120).map((line, index) => <Text key={index} color={line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : 'gray'}>{line}</Text>)}</Box>;
}
