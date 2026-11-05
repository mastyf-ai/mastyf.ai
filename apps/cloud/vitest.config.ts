import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Components use the automatic JSX runtime; tsconfig keeps JSX for Next to compile.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
