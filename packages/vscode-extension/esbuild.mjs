import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // jsonc-parser's UMD build loads its parts with require() at runtime; its ES module build bundles cleanly.
  mainFields: ['module', 'main'],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});
