import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ModelOption } from '../../llm/models.js';

export function ModelPicker({ currentModel, disabled, models, onCancel, onSelect }: { currentModel: string; disabled: boolean; models: ModelOption[]; onCancel: () => void; onSelect: (model: string) => void }) {
  const initialIndex = Math.max(0, models.findIndex((model) => model.id === currentModel));
  const [selected, setSelected] = useState(initialIndex);

  useInput((input, key) => {
    if (disabled) return;
    if (key.escape || input === 'q') { onCancel(); return; }
    if (key.upArrow) setSelected((current) => Math.max(0, current - 1));
    if (key.downArrow) setSelected((current) => Math.min(models.length - 1, current + 1));
    if (key.return) onSelect(models[selected].id);
  });

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Codex models</Text>
      <Text dimColor>Choose a model for this session. Press Esc to cancel.</Text>
      {models.map((model, index) => (
        <Box key={model.id} marginTop={1} flexDirection="column">
          <Text color={index === selected ? 'green' : undefined}>{index === selected ? '› ' : '  '}{model.id}{model.id === currentModel ? ' (current)' : ''}</Text>
          <Text dimColor>  {model.description}</Text>
        </Box>
      ))}
    </Box>
  );
}
