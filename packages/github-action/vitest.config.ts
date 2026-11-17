import { defineConfig } from 'vitest/config';

// One file at a time: several tests start the check engine, which is CPU-heavy to load.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 90000, hookTimeout: 180000, fileParallelism: false } });
