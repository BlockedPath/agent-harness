import { Box, Text } from 'ink';

export function formatTokens(total: number): string {
  return total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
}

export function StatusFooter({ status, providerId, model, usage }: { status: string; providerId: string; model: string; usage: { totalTokens: number } | null }) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text dimColor>{status}</Text>
      <Text dimColor>{providerId}/{model}{usage ? ` · ${formatTokens(usage.totalTokens)} tok` : ''}</Text>
    </Box>
  );
}
