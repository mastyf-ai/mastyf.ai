#!/usr/bin/env node
/**
 * Ensure workspace packages used by root tests are built (dist/ exports).
 * Skips when dist entrypoints already exist.
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const required = [
  { label: '@mastyf_ai/core', path: 'packages/core/dist/index.js', build: 'pnpm --filter @mastyf_ai/core run build' },
  {
    label: '@mastyf_ai/mcp-server/http-proxy',
    path: 'packages/server/dist/http-proxy.js',
    build: 'pnpm --filter @mastyf_ai/mcp-server run build',
  },
  {
    label: '@mastyf_ai/plugin-sdk',
    path: 'packages/plugin-sdk/dist/index.js',
    build: 'pnpm --filter @mastyf_ai/plugin-sdk run build',
  },
];

const builds = new Set();
for (const entry of required) {
  if (!existsSync(join(root, entry.path))) {
    console.log(`[ensure-workspace-built] missing ${entry.label} → ${entry.path}`);
    builds.add(entry.build);
  }
}

if (builds.size === 0) {
  console.log('[ensure-workspace-built] workspace packages already built');
  process.exit(0);
}

for (const cmd of builds) {
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}
