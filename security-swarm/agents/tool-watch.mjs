#!/usr/bin/env node
/**
 * ToolWatch Swarm agent — MCP server tool/schema integrity monitoring.
 */
import { spawnTool } from '../lib/run-step.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..', '..');

if (process.env.SWARM_TOOL_WATCH !== 'true') {
  console.log('[tool-watch] SWARM_TOOL_WATCH not enabled — skipping');
  process.exit(0);
}

const script = join(REPO, 'scripts', 'security-swarm', 'run-tool-watch.ts');
if (!existsSync(script)) {
  console.error('[tool-watch] Missing run-tool-watch.ts');
  process.exit(1);
}

const r = spawnTool('pnpm', ['exec', 'tsx', script], {
  cwd: REPO,
  stdio: 'inherit',
  env: process.env,
});

process.exit(r.status ?? 1);
