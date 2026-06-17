import type { ToolDefinitionFull } from '../tools/types.js';
import type { WorkspaceContext } from '../workspace/context.js';

const PLATFORM_LABEL: Record<string, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };

export function buildSystemPrompt(context: WorkspaceContext, tools: ToolDefinitionFull[]): string {
  const platform = PLATFORM_LABEL[process.platform] ?? process.platform;
  // Command sandboxing (filesystem/network isolation) is only enforced on macOS via
  // sandbox-exec; state the real platform so the model does not assume isolation it lacks.
  const sandboxNote = process.platform === 'darwin' ? '' : ' Shell commands are NOT sandboxed on this platform — be conservative.';
  return [
    `You are a coding agent running in a terminal harness on ${platform}.${sandboxNote} Use tools to inspect before editing. Prefer apply_patch for file changes. Ask the user before dangerous, network, or shell commands. Never access paths outside the workspace.`,
    context.agentsMd ? `Workspace instructions:\n${context.agentsMd}` : '',
    `Workspace file tree:\n${context.fileTree}`,
    `Manifest summary:\n${context.manifestSummary || 'No manifest files found.'}`,
    `Available tools:\n${JSON.stringify(tools.map((tool) => ({ name: tool.name, description: tool.description, risk: tool.risk })), null, 2)}`,
  ].filter(Boolean).join('\n\n');
}
