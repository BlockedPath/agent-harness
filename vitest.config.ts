import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // The TUI components (need a terminal) and live-network providers are not
      // unit-tested; exclude them so coverage reflects the logic we can test headlessly.
      exclude: ['**/*.test.ts', '**/*.test.tsx', '*.config.*', 'dist/**', 'src/tui/**', 'src/cli.tsx'],
      // Ratchet thresholds set just below current coverage to guard against regression
      // without failing today. Raise them as coverage improves.
      thresholds: {
        lines: 65,
        functions: 60,
        statements: 65,
        branches: 45,
      },
    },
  },
});
