import { defineConfig } from 'vitest/config';
import { workspacePackageAliases } from './vitest.workspace-aliases';

export default defineConfig({
  resolve: {
    alias: workspacePackageAliases,
  },
  test: {
    setupFiles: ['./tests/setup-env.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/integration/**',
      'tests/e2e-ui/**',
      'adversarial-harness/**',
      'apps/cloud/**',
    ],
    reporters: ['default', 'json', 'junit'],
    outputFile: {
      json: './test-results/results.json',
      junit: './test-results/junit.xml',
    },
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
      exclude: [
        'src/index.ts',
        'src/cli.ts',
        'src/policy/shell-tokenizer.ts',
        'src/validation/**',
        'src/tui/**',
        'src/utils/tracing.ts',
        'src/utils/tui-sources.ts',
        'src/utils/tls-checker.ts',
        'src/utils/swarm-artifacts.ts',
        'src/utils/security-swarm-runner.ts',
        'src/utils/upstream-cert-pin.ts',
        'src/utils/shutdown.ts',
        'src/utils/export-visuals-data.ts',
        'src/aggregator/**',
        'src/wrap/**',
        'src/exporters/exporter-manager.ts',
        'src/exporters/exporter-dlq.ts',
      ],
      thresholds: {
        lines: 58,
        functions: 65,
        branches: 55,
        statements: 58,
      },
    },
  },
});
