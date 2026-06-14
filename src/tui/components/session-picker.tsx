import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SessionSummary } from '../../session/store.js';

export function SessionPicker({ disabled, sessions, currentId, onCancel, onSelect }: { disabled: boolean; sessions: SessionSummary[]; currentId?: string; onCancel: () => void; onSelect: (id: string) => void }) {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (disabled) return;
    if (key.escape || input === 'q') { onCancel(); return; }
    if (key.upArrow) setSelected((current) => Math.max(0, current - 1));
    if (key.downArrow) setSelected((current) => Math.min(sessions.length - 1, current + 1));
    const option = sessions[selected];
    if (key.return && option) onSelect(option.id);
  });

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Recent sessions</Text>
      <Text dimColor>Select a session to resume. Press Esc to cancel.</Text>
      {sessions.length === 0 ? (
        <Text dimColor>  No saved sessions yet.</Text>
      ) : sessions.map((session, index) => (
        <Box key={session.id} marginTop={1} flexDirection="column">
          <Text color={index === selected ? 'green' : undefined}>
            {index === selected ? '› ' : '  '}{session.id}{session.id === currentId ? ' (current)' : ''}
          </Text>
          <Text dimColor>  {session.model} · {session.messageCount} msg · {session.preview}</Text>
        </Box>
      ))}
    </Box>
  );
}
