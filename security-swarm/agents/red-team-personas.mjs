#!/usr/bin/env node
/**
 * Red-team persona agents — Exfiltrator, PromptInjector, CostAmplifier, PrivilegeEscalator.
 */
import { spawnTool } from '../lib/run-step.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..', '..');

if (process.env.SWARM_RED_TEAM_PERSONAS !== 'true') {
  console.log('[red-team-personas] SWARM_RED_TEAM_PERSONAS not enabled — skipping');
  process.exit(0);
}

const script = join(REPO, 'scripts', 'security-swarm', 'run-red-team-personas.ts');
if (!existsSync(script)) {
  console.error('[red-team-personas] Missing run-red-team-personas.ts');
  process.exit(1);
}

const r = spawnTool('pnpm', ['exec', 'tsx', script], {
  cwd: REPO,
  stdio: 'inherit',
  env: process.env,
});

process.exit(r.status ?? 0);
