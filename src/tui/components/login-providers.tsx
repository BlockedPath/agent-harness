import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface ProviderOption {
  id: 'codex';
  label: string;
  description: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: 'codex', label: 'Codex', description: 'Sign in with your subscription in the browser.' },
];

export function LoginProviders({ disabled, onCancel, onSelect }: { disabled: boolean; onCancel: () => void; onSelect: (provider: ProviderOption['id']) => void }) {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (disabled) return;
    if (key.escape || input === 'q') { onCancel(); return; }
    if (key.upArrow) setSelected((current) => Math.max(0, current - 1));
    if (key.downArrow) setSelected((current) => Math.min(PROVIDERS.length - 1, current + 1));
    if (key.return) onSelect(PROVIDERS[selected].id);
  });

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Login providers</Text>
      <Text dimColor>Choose a provider to start browser OAuth. Press Esc to cancel.</Text>
      {PROVIDERS.map((provider, index) => (
        <Box key={provider.id} marginTop={1}>
          <Text color={index === selected ? 'green' : undefined}>{index === selected ? '› ' : '  '}{provider.label}</Text>
          <Text dimColor> - {provider.description}</Text>
        </Box>
      ))}
    </Box>
  );
}
