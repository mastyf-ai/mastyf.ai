import { defineConfig } from 'vitest/config';
// @ts-expect-error plain module shared with the esbuild script
import { stubFor } from './aliases.mjs';

export default defineConfig({
  plugins: [
    {
      name: 'check-stubs',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (!importer || !source.startsWith('.')) return null;
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        const abs = (resolved?.id ?? '').split('\\').join('/');
        return abs ? stubFor(abs) : null;
      },
    },
  ],
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 30000, hookTimeout: 180000 },
});
