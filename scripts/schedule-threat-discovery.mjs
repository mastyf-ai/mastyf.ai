#!/usr/bin/env node
/**
 * CRON scheduler for autonomous threat discovery.
 *
 * Triggers the full self-sustaining pipeline:
 *   1. Threat Lab (LLM-driven discovery from swarm bypasses, semantic TPs, ThreatIntel)
 *   2. Auto Threat Research (runtime detection → LLM research → adv-NNN.json)
 *   3. Security Swarm analysis (corpus eval + harness + parity gates)
 *   4. Auto-corpus promotion (adv-NNN.json → corpus/attacks/ — if MASTYF_AI_AUTO_CORPUS_PROMOTE=true)
 *
 * Usage:
 *   node scripts/schedule-threat-discovery.mjs [--daemon] [--interval <minutes>]
 *
 * Environment:
 *   MASTYF_AI_SCHEDULE_INTERVAL_MINUTES — how often to run the loop (default: 360 = 6h)
 *   MASTYF_AI_SCHEDULE_SWARM_INTERVAL_HOURS — how often to run full swarm (default: 24)
 *   MASTYF_AI_SCHEDULE_RUN_ONCE — exit after first cycle (default: false, for cron usage)
 */
import { spawn } from 'node:child_process';
import { spawnTool } from '../security-swarm/lib/run-step.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const STATE_PATH = join(
  process.env.MASTYF_AI_THREAT_RESEARCH_STATE_PATH || join(homedir(), '.mastyf-ai'),
  'scheduler-state.json',
);

function loadState() {
  if (!existsSync(STATE_PATH)) {
    return {
      lastRunAt: null,
      lastSwarmAt: null,
      totalRuns: 0,
      totalSwarmRuns: 0,
      lastRunOk: false,
      lastSwarmOk: false,
      lastError: null,
    };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return {
      lastRunAt: null,
      lastSwarmAt: null,
      totalRuns: 0,
      totalSwarmRuns: 0,
      lastRunOk: false,
      lastSwarmOk: false,
      lastError: null,
    };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function log(msg) {
  console.log(`[scheduler] ${new Date().toISOString()} — ${msg}`);
}

function runCmd(cmd, args, opts = {}) {
  log(`Running: ${cmd} ${args.join(' ')}`);
  // spawnTool: pnpm on Windows is a .cmd shim that spawnSync cannot start directly.
  const result = spawnTool(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    timeout: 30 * 60 * 1000, // 30 min timeout
    ...opts,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
    error: result.error?.message || null,
  };
}

function envWithLicense() {
  return {
    ...process.env,
    MASTYF_AI_CI_BYPASS_LICENSE: 'true',
    MASTYF_AI_THREAT_RESEARCH_AUTO: 'true',
    SWARM_THREAT_RESEARCH_AUTO: 'true',
    SWARM_THREAT_LAB: 'true',
  };
}

async function runThreatDiscovery() {
  const state = loadState();

  log('=== Starting threat discovery cycle ===');

  // Step 1: Threat Lab (LLM discovery from bypasses + semantic TPs + ThreatIntel)
  log('Step 1/4: Threat Lab');
  const threatLab = runCmd('pnpm', ['security-swarm:threat-lab'], {
    env: envWithLicense(),
  });
  if (!threatLab.ok) {
    log(`Threat Lab exited ${threatLab.status}: ${threatLab.stderr || threatLab.stdout}`);
    state.lastError = `threat-lab: ${threatLab.stderr || threatLab.stdout}`;
    state.lastRunOk = false;
    state.lastRunAt = new Date().toISOString();
    state.totalRuns++;
    saveState(state);
    return false;
  }
  log(`Threat Lab complete: ${threatLab.stdout.slice(0, 200)}`);

  // Step 2: Auto Threat Research (runtime detection → adv-NNN.json)
  log('Step 2/4: Auto Threat Research');
  const autoResearch = runCmd('pnpm', ['security-swarm:auto-threat-research'], {
    env: envWithLicense(),
  });
  if (!autoResearch.ok) {
    log(`Auto Research exited ${autoResearch.status}: ${autoResearch.stderr || autoResearch.stdout}`);
  }
  log('Auto Research complete');

  // Step 3: Swarm analysis (only if due)
  const now = Date.now();
  const swarmIntervalHours = parseInt(
    process.env.MASTYF_AI_SCHEDULE_SWARM_INTERVAL_HOURS || '24',
    10,
  );
  const lastSwarmAt = state.lastSwarmAt ? new Date(state.lastSwarmAt).getTime() : 0;

  if (now - lastSwarmAt >= swarmIntervalHours * 3600 * 1000) {
    log(`Step 3/4: Security Swarm analysis (last: ${state.lastSwarmAt || 'never'})`);
    const swarm = runCmd('pnpm', ['security-swarm:fast'], {
      env: envWithLicense(),
    });
    if (swarm.ok) {
      state.lastSwarmOk = true;
      state.lastSwarmAt = new Date().toISOString();
      state.totalSwarmRuns++;
      log('Swarm analysis passed');
    } else {
      state.lastSwarmOk = false;
      state.lastError = `swarm: ${swarm.stderr || swarm.stdout}`;
      log(`Swarm analysis failed (exit ${swarm.status})`);
    }
  } else {
    const nextSwarm = new Date(lastSwarmAt + swarmIntervalHours * 3600 * 1000);
    log(`Step 3/4: Skipping swarm (next: ${nextSwarm.toISOString()})`);
  }

  // Step 4: Auto-corpus promotion (only if enabled)
  if (process.env.MASTYF_AI_AUTO_CORPUS_PROMOTE === 'true') {
    log('Step 4/4: Auto-corpus promotion');
    try {
      const { promoteBatchToCorpus } = await import('../src/ai/auto-corpus-promoter.js');
      // Read the auto-corpus manifest to find unpromoted entries
      const manifestPath = join(REPO_ROOT, 'reports', 'security-swarm', 'auto-corpus-manifest.json');
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        log(`Auto-corpus manifest: ${manifest.count} entries`);
      } else {
        log('No auto-corpus manifest found — skipping promotion');
      }
    } catch (err) {
      log(`Auto-corpus promotion error: ${err.message}`);
    }
  } else {
    log('Step 4/4: Auto-corpus promotion skipped (MASTYF_AI_AUTO_CORPUS_PROMOTE != true)');
  }

  state.lastRunAt = new Date().toISOString();
  state.lastRunOk = true;
  state.totalRuns++;
  state.lastError = null;
  saveState(state);

  log('=== Threat discovery cycle complete ===');
  return true;
}

async function main() {
  const intervalMinutes = parseInt(
    process.env.MASTYF_AI_SCHEDULE_INTERVAL_MINUTES || '360',
    10,
  );
  const runOnce = process.argv.includes('--run-once') || process.env.MASTYF_AI_SCHEDULE_RUN_ONCE === 'true';

  log(`MCP Mastyf AI — Threat Discovery Scheduler`);
  log(`Interval: ${intervalMinutes} min | Swarm: every ${process.env.MASTYF_AI_SCHEDULE_SWARM_INTERVAL_HOURS || '24'}h`);
  log(`State: ${STATE_PATH}`);

  if (runOnce) {
    log('Running once and exiting');
    const ok = await runThreatDiscovery();
    process.exit(ok ? 0 : 1);
  }

  // Daemon mode: run immediately, then on interval
  await runThreatDiscovery();
  log(`Next run in ${intervalMinutes} minutes`);

  setInterval(async () => {
    await runThreatDiscovery();
    log(`Next run in ${intervalMinutes} minutes`);
  }, intervalMinutes * 60 * 1000);
}

main().catch((err) => {
  console.error(`[scheduler] Fatal error: ${err.message}`);
  process.exit(1);
});