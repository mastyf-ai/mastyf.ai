#!/usr/bin/env node
/**
 * Vercel/CI: compile @mastyf_ai/server before Next.js typecheck (package-scorer lives in dist/).
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const scorerJs = join(repoRoot, 'dist/agentic/trust-score/score-package-by-name.js');

if (existsSync(scorerJs)) {
  console.log('[cloud prebuild] @mastyf_ai/server already built');
} else if (process.env.VERCEL || process.env.SKIP_SERVER_BUILD) {
  console.log('[cloud prebuild] Skipping @mastyf_ai/server build (VERCEL or SKIP_SERVER_BUILD set)');
} else {
  console.log('[cloud prebuild] Building @mastyf_ai/server (package-scorer)…');
  try {
    execSync('pnpm build:mastyf-ai', { cwd: repoRoot, stdio: 'inherit' });
  } catch {
    console.warn('[cloud prebuild] Failed to build @mastyf_ai/server, continuing…');
  }
}
