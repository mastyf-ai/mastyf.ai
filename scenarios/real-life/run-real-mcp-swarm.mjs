#!/usr/bin/env node
/**
 * End-to-end real-life validation: official filesystem MCP + hybrid learning + swarm gates + visuals.
 *
 * Usage:
 *   pnpm build
 *   MCP_FS_ROOT=/tmp/mastyf-ai-rl node scenarios/real-life/run-real-mcp-swarm.mjs [--skip-swarm] [--skip-visuals]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOfficialFilesystemScenario } from './run-official-filesystem-scenario.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const SWARM_DIR = join(ROOT, 'reports', 'security-swarm');
const LIVE_JSON = resolve(__dirname, 'output', 'live-filesystem-session.json');
const VISUALS_SCRIPT = join(SWARM_DIR, 'scripts', 'generate-swarm-visuals.py');

const SKIP_SWARM = process.argv.includes('--skip-swarm');
const SKIP_VISUALS = process.argv.includes('--skip-visuals');

function run(cmd, args, opts = {}) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} exited ${r.status}`);
  }
  return r.status ?? 1;
}

function mergeRealLifeSummary(liveReport) {
  const summaryPath = join(SWARM_DIR, 'summary.md');
  let swarmMd = '';
  try {
    // Read directly instead of existsSync-then-read, so the file can't change in between.
    swarmMd = readFileSync(summaryPath, 'utf-8');
  } catch {
    swarmMd = '';
  }

  const liveSection = `
## Track B — Live official filesystem MCP

**Upstream:** \`@modelcontextprotocol/server-filesystem\`  
**Sandbox:** \`${liveReport.mcpFsRoot}\`  
**Profile:** hybrid (instant learning + semantic async)  
**Generated:** ${liveReport.timestamp}

| Metric | Value |
|--------|-------|
| Scenarios run | ${liveReport.summary.scenariosRun} |
| Scenarios passed | ${liveReport.summary.scenariosPassed}/${liveReport.summary.scenariosRun} |
| Learning burst repeats | ${liveReport.summary.burstRuns} |
| Tools discovered | ${liveReport.toolsDiscovered.join(', ')} |

### Per-scenario results

| Scenario | Tool | Expected | Actual | OK |
|----------|------|----------|--------|-----|
${liveReport.proxyResults.map((r) => `| ${r.scenario} | ${r.tool} | ${r.expected} | ${r.actual} | ${r.ok ? 'yes' : 'no'} |`).join('\n')}

**Artifact:** [scenarios/real-life/output/live-filesystem-session.json](../../scenarios/real-life/output/live-filesystem-session.json)

---

## Track A — Security swarm gates (regex-only)

`;

  const trackAIdx = swarmMd.indexOf('## Executive summary');
  if (trackAIdx >= 0) {
    swarmMd = swarmMd.slice(0, trackAIdx) + liveSection + swarmMd.slice(trackAIdx);
  } else {
    swarmMd = `# Security Swarm — Real-Life Validation\n\n${liveSection}${swarmMd}`;
  }

  mkdirSync(SWARM_DIR, { recursive: true });
  writeFileSync(summaryPath, swarmMd);
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  Real-life MCP Mastyf AI + Security Swarm');
  console.log('═'.repeat(60));

  if (!existsSync(join(ROOT, 'dist', 'cli.js'))) {
    run('pnpm', ['build']);
  }

  const liveReport = await runOfficialFilesystemScenario();
  console.log(`\nLive session: ${liveReport.summary.scenariosPassed}/${liveReport.summary.scenariosRun} scenarios OK`);
  console.log(`Written: ${LIVE_JSON}`);

  if (!liveReport.summary.allPassed) {
    console.error('Live filesystem scenarios failed — aborting before swarm');
    process.exit(1);
  }

  run('pnpm', ['security-swarm:calibrate'], { allowFail: true });

  if (!SKIP_SWARM) {
    run('pnpm', ['security-swarm:fast'], {
      env: {
        MASTYF_AI_POLICY_TIMING_ENVELOPE: 'false',
        MASTYF_AI_DISABLE_SEMANTIC: 'true',
      },
    });
  }

  mergeRealLifeSummary(liveReport);

  if (!SKIP_VISUALS && existsSync(VISUALS_SCRIPT)) {
    const py = existsSync(join(ROOT, '.venv-charts', 'bin', 'python'))
      ? join(ROOT, '.venv-charts', 'bin', 'python')
      : 'python3';
    run(py, [VISUALS_SCRIPT], { allowFail: true });
  }

  console.log('\n═'.repeat(60));
  console.log('  Done');
  console.log('═'.repeat(60));
  console.log(`  Live JSON:  ${LIVE_JSON}`);
  console.log(`  Swarm:      ${join(SWARM_DIR, 'summary.md')}`);
  console.log(`  Text:       ${join(SWARM_DIR, 'swarm-report.txt')}`);
  console.log(`  Figures:    ${join(SWARM_DIR, 'figures')}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
