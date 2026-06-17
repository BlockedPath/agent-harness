import { describe, expect, it } from 'vitest';
import { sanitizeEnv } from './executor.js';

describe('sanitizeEnv', () => {
  it('strips API keys, tokens, and connection-string credentials', () => {
    const out = sanitizeEnv({
      OPENAI_API_KEY: 'sk-x',
      ANTHROPIC_API_KEY: 'sk-y',
      GITHUB_TOKEN: 'gh',
      GITHUB_PAT: 'pat',
      DATABASE_URL: 'postgres://u:p@h/db',
      REDIS_URL: 'redis://u:p@h',
      MONGODB_URI: 'mongodb://u:p@h',
      AWS_SECRET_ACCESS_KEY: 'a',
    });
    for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_PAT', 'DATABASE_URL', 'REDIS_URL', 'MONGODB_URI', 'AWS_SECRET_ACCESS_KEY']) {
      expect(out[k]).toBeUndefined();
    }
  });

  it('drops library-injection vectors', () => {
    const out = sanitizeEnv({ LD_PRELOAD: '/x.so', DYLD_INSERT_LIBRARIES: '/y.dylib', LD_LIBRARY_PATH: '/z' });
    expect(out.LD_PRELOAD).toBeUndefined();
    expect(out.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(out.LD_LIBRARY_PATH).toBeUndefined();
  });

  it('keeps benign vars needed to run commands', () => {
    const out = sanitizeEnv({ PATH: '/usr/bin', HOME: '/home/x', LANG: 'en_US.UTF-8' });
    expect(out.PATH).toBe('/usr/bin');
    expect(out.HOME).toBe('/home/x');
    expect(out.LANG).toBe('en_US.UTF-8');
  });
});
