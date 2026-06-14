import type { ToolDefinition } from '../llm/types.js';
import { toJsonSchema } from '../util/json-schema.js';
import { applyPatchTool } from './apply_patch.js';
import { askUserTool } from './ask_user.js';
import { createFileTool } from './create_file.js';
import { deleteFileTool } from './delete_file.js';
import { gitDiffTool } from './git_diff.js';
import { gitStatusTool } from './git_status.js';
import { listFilesTool } from './list_files.js';
import { readFileTool } from './read_file.js';
import { replaceStringTool } from './replace_string.js';
import { runCommandTool } from './run_command.js';
import { searchFilesTool } from './search_files.js';
import type { ToolDefinitionFull } from './types.js';

export const ALL_TOOLS = [readFileTool, listFilesTool, searchFilesTool, applyPatchTool, replaceStringTool, createFileTool, deleteFileTool, runCommandTool, gitStatusTool, gitDiffTool, askUserTool] satisfies ToolDefinitionFull[];

export function getTool(name: string): ToolDefinitionFull | undefined { return ALL_TOOLS.find((tool) => tool.name === name); }
export function toProviderTools(tools: ToolDefinitionFull[] = ALL_TOOLS): ToolDefinition[] { return tools.map(({ name, description, parameters }) => ({ name, description, parameters })); }
export function toJsonSchemaTools(tools: ToolDefinitionFull[] = ALL_TOOLS): unknown[] { return tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: toJsonSchema(tool.parameters) })); }
