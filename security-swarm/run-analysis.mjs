#!/usr/bin/env node
import './lib/gate-pro.mjs';
/**
 * One-click Security Swarm analysis — live MCP + gates + detailed analysis.txt
 *
 * Usage:
 *   node security-swarm/run-analysis.mjs [--full] [--nightly] [--skip-live] [--skip-swarm] [--quiet] [--continuous] [--skip-continuous]
 */
import { runStep } from './lib/run-step.mjs';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOfficialFilesystemScenario } from '../scenarios/real-life/run-official-filesystem-scenario.mjs';
import { runContinuousLiveAttack } from '../scenarios/real-life/run-continuous-live-attack.mjs';
import { writeDetailedAnalysis } from './agents/analysis-report.mjs';
import { writeTrafficSummary } from './agents/traffic-summary.mjs';
import { writePlainEnglishReport } from './agents/plain-english-report.mjs';
import {
  REPO_ROOT,
  SWARM_DIR,
  JOB_LOG_PATH,
  writeJob,
  appendJobLog,
  phaseById,
} from './lib/job-state.mjs';

const FULL = process.argv.includes('--full');
const NIGHTLY = process.argv.includes('--nightly');
const SKIP_LIVE = process.argv.includes('--skip-live');
const SKIP_SWARM = process.argv.includes('--skip-swarm');
const QUIET = process.argv.includes('--quiet');
const RUN_CONTINUOUS = process.argv.includes('--continuous');
const SKIP_CONTINUOUS = process.argv.includes('--skip-continuous') || process.env.MASTYF_AI_SWARM_SKIP_CONTINUOUS === 'true';

const LIVE_JSON = join(REPO_ROOT, 'scenarios', 'real-life', 'output', 'live-filesystem-session.json');
const VISUALS_SCRIPT = join(SWARM_DIR, 'scripts', 'generate-swarm-visuals.py');
const CLI_DIST = join(REPO_ROOT, 'dist', 'cli.js');

const startedAt = new Date().toISOString();
let exitCode = 0;
let liveOk = true;
let swarmOk = true;

function log(msg) {
  if (QUIET) {
    appendJobLog(msg);
  } else {
    console.log(msg);
  }
}

function emitArtifact(paths) {
  try {
    const marker = join(SWARM_DIR, '.artifact-emit.json');
    writeFileSync(
      marker,
      JSON.stringify({ paths, at: new Date().toISOString() }),
    );
  } catch {
    /* dashboard watcher reads files directly */
  }
}

function setPhase(phaseId) {
  const p = phaseById(phaseId);
  writeJob({
    state: 'running',
    phase: phaseId,
    phaseLabel: p.label,
    progressPct: p.progressPct,
    startedAt,
    finishedAt: null,
    exitCode: null,
    error: null,
  });
  log(`[phase] ${p.label} (${p.progressPct}%)`);
}

function run(cmd, args, opts = {}) {
  const label = opts.label || `${cmd} ${args.join(' ')}`;
  log(`▶ ${label}`);
  const r = runStep(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    label,
    stepKey: opts.stepKey ?? label,
    live: !QUIET,
    env: { ...process.env, ...opts.env },
  });
  if (QUIET) {
    if (r.stdout) appendJobLog(String(r.stdout).slice(-8000));
    if (r.stderr) appendJobLog(String(r.stderr).slice(-8000));
  }
  if ((r.status !== 0 || r.timedOut) && !opts.allowFail) {
    throw new Error(`${label} exited ${r.status ?? 1}${r.timedOut ? ' (timeout)' : ''}`);
  }
  return r.status ?? 1;
}

function mergeRealLifeSummary(liveReport) {
  const summaryPath = join(SWARM_DIR, 'summary.md');
  let swarmMd = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf-8') : '';
  const liveSection = `
## Track B — Live official filesystem MCP

**Upstream:** \`@modelcontextprotocol/server-filesystem\`  
**Sandbox:** \`${liveReport.mcpFsRoot}\`  
**Profile:** hybrid  
**Generated:** ${liveReport.timestamp}

| Scenarios passed | ${liveReport.summary.scenariosPassed}/${liveReport.summary.scenariosRun} |

See **analysis.txt** for full per-scenario breakdown.

---

## Track A — Security swarm gates

`;
  if (swarmMd.includes('## Track B')) {
    return;
  }
  swarmMd = `# Security Swarm — Analysis\n\n${liveSection}${swarmMd}`;
  mkdirSync(SWARM_DIR, { recursive: true });
  writeFileSync(summaryPath, swarmMd);
}

async function main() {
  mkdirSync(SWARM_DIR, { recursive: true });
  if (QUIET && existsSync(JOB_LOG_PATH)) {
    writeFileSync(JOB_LOG_PATH, '');
  }

  writeJob({
    jobId: randomUUID(),
    state: 'running',
    phase: 'preflight',
    phaseLabel: 'Preflight',
    progressPct: 0,
    startedAt,
    finishedAt: null,
    exitCode: null,
    error: null,
  });

  if (!QUIET) {
    console.log('═'.repeat(60));
    console.log('  MCP Mastyf AI — Security Swarm Analysis');
    console.log('═'.repeat(60));
  }

  try {
    setPhase('preflight');
    if (!existsSync(CLI_DIST)) {
      log('dist/cli.js missing — will run pnpm build');
    }

    setPhase('build');
    if (!existsSync(CLI_DIST)) {
      run('pnpm', ['build']);
    }

    if (!SKIP_LIVE) {
      setPhase('live-mcp');
      process.env.MASTYF_AI_SEMANTIC_STORE_CALIBRATION = 'true';
      process.env.SWARM_CALIBRATE_CAPTURE = 'true';
      process.env.REAL_LIFE_METRICS_ENABLED = 'false';
      process.env.REAL_LIFE_PROXY_READY_MS = process.env.REAL_LIFE_PROXY_READY_MS || '45000';
      process.env.REAL_LIFE_UPSTREAM_READY_MS = process.env.REAL_LIFE_UPSTREAM_READY_MS || '90000';
      process.env.MASTYF_AI_POLICY_SYNC_ENABLED = 'false';
      process.env.MASTYF_AI_AUDIT_SYNC_ENABLED = 'false';
      if (FULL && !process.env.REAL_LIFE_BURST_REPEATS) {
        process.env.REAL_LIFE_BURST_REPEATS = '20';
      }
      const liveReport = await runOfficialFilesystemScenario();
      liveOk = liveReport.summary?.allPassed ?? false;
      if (liveReport.summary?.scenariosRun === 0) {
        log(`Live MCP skipped: ${liveReport.summary?.error || 'no tools discovered'}`);
        liveOk = false;
      }
      const failedLive = (liveReport.proxyResults || []).filter((r) => !r.ok);
      log(`Live MCP: ${liveReport.summary.scenariosPassed}/${liveReport.summary.scenariosRun} scenarios OK`);
      if (failedLive.length) {
        const detail = failedLive
          .map((r) => `${r.scenario} (expected ${r.expected}, got ${r.actual})`)
          .join('; ');
        log(`Live MCP failures: ${detail}`);
        if (process.env.SWARM_LIVE_STRICT === 'true') {
          throw new Error(`Live filesystem scenarios failed: ${detail}`);
        }
        log('Continuing pipeline (core gates + calibration still run). Set SWARM_LIVE_STRICT=true to fail hard.');
      }
    } else {
      log('Skipping live MCP (--skip-live)');
    }

    setPhase('user-servers');
    try {
      run('node', ['scripts/security-swarm/probe-user-servers.mjs'], { allowFail: true });
      emitArtifact(['user-servers-session.json']);
    } catch (err) {
      log(`User server probes: ${err instanceof Error ? err.message : String(err)}`);
    }

    setPhase('traffic');
    try {
      const traffic = await writeTrafficSummary();
      log(`Traffic summary: ${traffic.totalCalls} calls (${traffic.totalBlocked} blocked)`);
      emitArtifact(['traffic-summary.json']);
      await writePlainEnglishReport({ liveOk, swarmOk: swarmOk ?? false });
      emitArtifact(['report.json']);
    } catch (err) {
      log(`Traffic summary: ${err instanceof Error ? err.message : String(err)}`);
    }

    setPhase('calibrate');
    run('pnpm', ['security-swarm:calibrate'], {
      allowFail: true,
      env: {
        SWARM_CALIBRATE_AUTO_LABEL: process.env.SWARM_CALIBRATE_AUTO_LABEL ?? 'false',
      },
    });

    if (!SKIP_SWARM) {
      setPhase('swarm');
      const swarmArgs = NIGHTLY ? ['--quiet'] : ['--fast', '--quiet'];
      log(
        NIGHTLY
          ? 'Swarm gates (nightly): corpus + full adversarial harness — typically 30–60 min, output streams below…'
          : 'Swarm gates (fast): corpus + harness parity — typically 3–5 min…',
      );
      run('node', ['security-swarm/run.mjs', ...swarmArgs], {
        env: {
          MASTYF_AI_POLICY_TIMING_ENVELOPE: 'false',
          MASTYF_AI_DISABLE_SEMANTIC: 'true',
        },
      });
      const latest = existsSync(join(SWARM_DIR, 'latest.json'))
        ? JSON.parse(readFileSync(join(SWARM_DIR, 'latest.json'), 'utf-8'))
        : null;
      swarmOk = latest?.overall ?? false;
      if (existsSync(LIVE_JSON)) {
        mergeRealLifeSummary(JSON.parse(readFileSync(LIVE_JSON, 'utf-8')));
      }
      if (process.env.SWARM_THREAT_LAB === 'true') {
        run('node', ['security-swarm/agents/threat-lab.mjs'], { allowFail: true });
        emitArtifact(['threat-lab-candidates.json']);
      }
      if (process.env.SWARM_THREAT_RESEARCH_AUTO === 'true') {
        run('node', ['security-swarm/agents/auto-threat-research.mjs'], { allowFail: true });
        emitArtifact(['auto-corpus-manifest.json']);
      }
    } else {
      log('Skipping swarm (--skip-swarm)');
    }

    setPhase('visuals');
    try {
      const { writeVisualsDataBundle } = await import('./agents/visuals-data.mjs');
      const vd = await writeVisualsDataBundle();
      log(`Visuals data: ${vd.traffic?.totalCalls ?? 0} calls, learning=${vd.instantLearning?.source ?? 'none'}`);
      emitArtifact(['visuals-data.json']);
    } catch (err) {
      log(`Visuals data export: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (existsSync(VISUALS_SCRIPT)) {
      const py = existsSync(join(REPO_ROOT, '.venv-charts', 'bin', 'python'))
        ? join(REPO_ROOT, '.venv-charts', 'bin', 'python')
        : 'python3';
      run(py, [VISUALS_SCRIPT], { allowFail: true });
      emitArtifact(['figures/manifest.json', 'visuals-data.json']);
    }

    setPhase('report');
    try {
      const latest = existsSync(join(SWARM_DIR, 'latest.json'))
        ? JSON.parse(readFileSync(join(SWARM_DIR, 'latest.json'), 'utf-8'))
        : null;
      swarmOk = latest?.overall ?? swarmOk;
      await writePlainEnglishReport({ liveOk, swarmOk });
      emitArtifact(['report.json', 'traffic-summary.json', 'user-servers-session.json', 'visuals-data.json']);
      log(`Plain-English report: ${join(SWARM_DIR, 'report.json')}`);
    } catch (err) {
      log(`Report: ${err instanceof Error ? err.message : String(err)}`);
    }

    setPhase('analysis');
    const { latestPath } = writeDetailedAnalysis({
      liveOk,
      swarmOk,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    log(`Detailed analysis: ${latestPath}`);

    if ((RUN_CONTINUOUS || process.env.LIVE_ATTACK_AUTO === 'true') && !SKIP_CONTINUOUS) {
      log('Starting continuous live attack stream…');
      process.env.REAL_LIFE_METRICS_ENABLED = 'false';
      const continuousReport = await runContinuousLiveAttack();
      log(
        `Continuous live: block ${((continuousReport.summary.attackBlockRate ?? 0) * 100).toFixed(1)}%`
        + ` FP ${((continuousReport.summary.benignFpRate ?? 0) * 100).toFixed(1)}%`,
      );
      const { latestPath: analysisAfter } = writeDetailedAnalysis({
        liveOk,
        swarmOk,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      log(`Updated analysis (continuous): ${analysisAfter}`);
    }

    emitArtifact(['analysis.txt', 'latest.json']);
  } catch (err) {
    exitCode = 1;
    const msg = err instanceof Error ? err.message : String(err);
    log(`FAILED: ${msg}`);
    try {
      writeDetailedAnalysis({
        liveOk: false,
        swarmOk: false,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }
    writeJob({
      state: 'failed',
      finishedAt: new Date().toISOString(),
      exitCode: 1,
      error: msg,
      progressPct: 100,
    });
    if (!QUIET) console.error(err);
    process.exit(1);
  }

  writeJob({
    state: 'done',
    phase: 'analysis',
    phaseLabel: 'Complete',
    progressPct: 100,
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    error: null,
  });

  if (!QUIET) {
    console.log('\n═'.repeat(60));
    console.log('  Analysis complete');
    console.log('═'.repeat(60));
    console.log(`  Open: reports/security-swarm/analysis.txt`);
  }
  process.exit(exitCode);
}

main();
