import { z } from 'zod';
import { resolveWorkspacePath } from '../sandbox/workspace-boundary.js';
import { walkWorkspace } from '../workspace/glob.js';
import type { ToolDefinitionFull } from './types.js';

const DEFAULT_IGNORES = new Set(['node_modules', '.git', '.harness', '.pi', '.DS_Store', 'dist']);
const schema = z.object({ pattern: z.string(), path: z.string().optional() });

export const globTool: ToolDefinitionFull<z.infer<typeof schema>> = {
  name: 'glob',
  description: 'Find files whose path matches a glob pattern (e.g. "src/**/*.ts"). Use * within a segment and ** across directories.',
  parameters: schema,
  risk: 'read',
  async run(input, ctx) {
    const root = resolveWorkspacePath(ctx.workspaceRoot, input.path ?? '.');
    const entries = await walkWorkspace(root, { maxDepth: 12, ignores: DEFAULT_IGNORES });
    const regex = globToRegExp(input.pattern);
    const matches = entries.filter((entry) => !entry.isDirectory && regex.test(entry.relativePath)).map((entry) => entry.relativePath);
    return { ok: true, output: matches.length ? matches.slice(0, 500).join('\n') : 'No files matched.' };
  },
};

/**
 * Translate a glob into an anchored regex: `**` spans path separators, `*` stays
 * within a segment, `?` matches a single non-separator character.
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === undefined) continue;
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}
