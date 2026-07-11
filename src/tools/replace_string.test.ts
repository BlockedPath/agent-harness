import { describe, expect, it } from 'vitest';
import { replaceStringTool } from './replace_string.js';

describe('replaceStringTool', () => {
  it('rejects an empty oldString in its schema', () => {
    expect(replaceStringTool.parameters.safeParse({ path: 'f.txt', oldString: '', newString: 'x' }).success).toBe(false);
  });
});
