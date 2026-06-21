#!/usr/bin/env node
/**
 * Vercel/CI: compile @mastyf-ai/server before Next.js typecheck (package-scorer lives in dist/).
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const scorerJs = join(repoRoot, 'dist/agentic/trust-score/score-package-by-name.js');

if (!existsSync(scorerJs)) {
  console.log('[cloud prebuild] Building @mastyf-ai/server (package-scorer)…');
  execSync('pnpm build:mastyf-ai', { cwd: repoRoot, stdio: 'inherit' });
} else {
  console.log('[cloud prebuild] @mastyf-ai/server already built');
}
