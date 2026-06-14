import React from 'react';
import { Box, Text } from 'ink';
import { useTuiStore } from '../store.js';
import { DiffView } from './diff-view.js';

export function ApprovalModal() {
  const { state } = useTuiStore();
  if (!state.approvalRequest) return null;
  return <Box borderStyle="double" flexDirection="column" paddingX={1}><Text color="yellow">Allow {state.approvalRequest.name}? [y]es [n]o</Text><DiffView diff={state.approvalRequest.diff} /></Box>;
}
