import { Box, Text, useInput } from 'ink';
import type { CredentialNotice } from '../store.js';

export function CredentialNoticePanel({ notice, onCancel, onLogin }: { notice: CredentialNotice; onCancel: () => void; onLogin: () => void }) {
  useInput((input, key) => {
    if (key.escape || input === 'q') { onCancel(); return; }
    if (key.return && notice.action === 'login') onLogin();
  });

  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="yellow">Authentication required</Text>
      <Text>{notice.message}</Text>
      {notice.action === 'set-env' && notice.envVar ? <Text>Set <Text bold>{notice.envVar}</Text>, then restart the harness.</Text> : null}
      {notice.action === 'set-env' && notice.envVar ? <Text color="green">export {notice.envVar}=...</Text> : null}
      {notice.action === 'fix-config' ? <Text>Fix the provider configuration, then restart the harness.</Text> : null}
      {notice.action === 'login' ? <Text>Press Enter to sign in with Codex, or Esc to return to setup.</Text> : <Text dimColor>Press Esc to return to chat, or Ctrl-C to exit.</Text>}
    </Box>
  );
}
