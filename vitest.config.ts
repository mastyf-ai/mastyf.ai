import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@mcp-guardian/plugin-sdk': path.resolve(__dirname, 'packages/plugin-sdk/dist/index.js'),
    },
  },
  test: {
    setupFiles: ['./tests/setup-env.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/integration/**',
      'adversarial-harness/**',
    ],
    maxConcurrency: 1,
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
    // Piping vitest stdout (e.g. `| tail -6`) is fully buffered until the process exits — no dots until done.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/cli.ts', 'src/policy/shell-tokenizer.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
});
