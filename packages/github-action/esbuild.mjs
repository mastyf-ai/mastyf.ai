// Builds the Action: dist/main.cjs and dist/post.cjs (GitHub runs them as they are), plus the free
// check engine and its default policy copied from @mastyf_ai/check into dist/engine/.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const check = join(here, '..', 'check');
const engine = join(check, 'dist', 'mastyf-check.cjs');
if (!existsSync(engine)) {
  console.error('The check engine bundle is missing: build it first (cd packages/check && node esbuild.mjs).');
  process.exit(1);
}

for (const name of ['main', 'post', 'claude-hook']) {
  await build({
    entryPoints: [join(here, 'src', `${name}.ts`)],
    outfile: join(here, 'dist', `${name}.cjs`),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    legalComments: 'none',
    logLevel: 'warning',
  });
}

mkdirSync(join(here, 'dist', 'engine'), { recursive: true });
copyFileSync(engine, join(here, 'dist', 'engine', 'mastyf-check.cjs'));
copyFileSync(join(check, 'check-default-policy.yaml'), join(here, 'dist', 'engine', 'check-default-policy.yaml'));
// The engine is AGPL-3.0 (the Action's own code is MIT): its licence travels with it.
copyFileSync(join(check, 'LICENSE'), join(here, 'dist', 'engine', 'LICENSE'));
