import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, filterTools } from './registry.js';

describe('filterTools', () => {
  it('returns every tool when no policy is provided', () => {
    expect(filterTools()).toBe(ALL_TOOLS);
  });

  it('keeps only explicitly allowed tools when allow is non-empty', () => {
    expect(filterTools(ALL_TOOLS, { allow: ['read_file'] }).map((tool) => tool.name)).toEqual(['read_file']);
  });

  it('removes denied tools', () => {
    const names = filterTools(ALL_TOOLS, { deny: ['run_command'] }).map((tool) => tool.name);

    expect(names).not.toContain('run_command');
    expect(names).toHaveLength(ALL_TOOLS.length - 1);
  });

  it('lets deny win over allow', () => {
    expect(filterTools(ALL_TOOLS, { allow: ['read_file', 'run_command'], deny: ['run_command'] }).map((tool) => tool.name)).toEqual(['read_file']);
  });
});
