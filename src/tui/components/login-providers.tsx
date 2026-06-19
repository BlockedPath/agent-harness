import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface ProviderOption {
  id: 'codex';
  label: string;
  description: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: 'codex', label: 'Codex', description: 'Sign in with your subscription in the browser.' },
];

export function LoginProviders({ disabled, reason, onCancel, onSelect }: { disabled: boolean; reason?: string; onCancel: () => void; onSelect: (provider: ProviderOption['id']) => void }) {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (disabled) return;
    if (key.escape || input === 'q') { onCancel(); return; }
    if (key.upArrow) setSelected((current) => Math.max(0, current - 1));
    if (key.downArrow) setSelected((current) => Math.min(PROVIDERS.length - 1, current + 1));
    const option = PROVIDERS[selected];
    if (key.return && option) onSelect(option.id);
  });

  return (
    <Box borderStyle="round" borderColor={reason ? 'yellow' : undefined} flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={reason ? 'yellow' : undefined}>Codex login</Text>
      {reason ? <Text>{reason}</Text> : null}
      <Text dimColor>{reason ? 'Enter signs in · Esc returns to setup · Ctrl-C exits.' : 'Enter signs in · Esc returns to chat.'}</Text>
      {PROVIDERS.map((provider, index) => (
        <Box key={provider.id} marginTop={1}>
          <Text color={index === selected ? 'green' : undefined} inverse={index === selected} bold={index === selected}>{index === selected ? '› ' : '  '}{provider.label}</Text>
          <Text dimColor> - {disabled ? 'Opening browser…' : provider.description}</Text>
        </Box>
      ))}
    </Box>
  );
}
