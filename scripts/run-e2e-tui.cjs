#!/usr/bin/env node
/**
 * Comprehensive E2E pipeline → seeds ~/.mastyf-ai/history.db for the TUI.
 *
 * Phases:
 *   1. Security scan (CLI) → security_scans table
 *   2. In-process proxy corpus (21 agent calls) → call_records
 *   3. Health check (CLI) → health_checks table
 *   4. Cost audit (CLI) → cost_records (from call_records)
 *   5. AI state files for AI Engine tab
 *
 * Usage:
 *   node scripts/run-e2e-tui.cjs           # prep + launch TUI
 *   node scripts/run-e2e-tui.cjs --no-tui    # prep only
 *   pnpm run e2e:tui
 */
const { spawn, spawnSync } = require('child_process');
const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  copyFileSync,
} = require('fs');
const { join, resolve } = require('path');
const { homedir } = require('os');

const ROOT = resolve(__dirname, '..');
const SCENARIO = join(ROOT, 'scenarios', 'dogfood');
const CLI = join(ROOT, 'dist', 'cli.js');
const CORPUS = JSON.parse(readFileSync(join(SCENARIO, 'agent-corpus.json'), 'utf8'));
const POLICY = join(ROOT, 'default-policy.yaml');
const LOCAL_SERVICE = join(SCENARIO, 'enterprise-mcp-local-service.cjs');
const SERVER_NAMES = ['github', 'filesystem', 'puppeteer', 'postgres'];
const MASTYF_AI_DIR = join(homedir(), '.mastyf-ai');
const DB_PATH = join(MASTYF_AI_DIR, 'history.db');
const LAUNCH_TUI = !process.argv.includes('--no-tui');

const BANNER = '═'.repeat(72);
const log = (m) => process.stdout.write(m + '\n');
const banner = (t) => log('\n' + BANNER + '\n  ' + t + '\n' + BANNER);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runCli(args, extraEnv = {}, timeoutMs = 120000) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return {
    code: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

(async function main() {
  banner('MASTYF AI — E2E PIPELINE → TUI (v2.5.1)');

  if (!existsSync(CLI)) {
    log('dist/cli.js missing — running pnpm run build ...');
    const b = spawnSync('pnpm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (b.status !== 0) process.exit(1);
  }

  mkdirSync(MASTYF_AI_DIR, { recursive: true });
  const backupPath = join(MASTYF_AI_DIR, `history.db.bak-${Date.now()}`);
  if (existsSync(DB_PATH)) {
    try {
      copyFileSync(DB_PATH, backupPath);
      log(`Backed up existing DB → ${backupPath}`);
    } catch (_) {}
    rmSync(DB_PATH, { force: true });
    rmSync(DB_PATH + '.pid', { force: true });
  }

  const baseEnv = {
    MASTYF_AI_DB_PATH: DB_PATH,
    DASHBOARD_ENABLED: 'false',
    METRICS_ENABLED: 'false',
    MASTYF_AI_ALLOW_MODE_OVERRIDE: 'true',
    MASTYF_AI_SKIP_PREFLIGHT_SCAN: 'true',
    MASTYF_AI_BLOCK_ON_CVE: 'false',
    MASTYF_AI_POLICY_PATH: POLICY,
    HOME: process.env.HOME,
    PATH: process.env.PATH,
  };
  // In-process proxy reads process.env (not spawn env)
  process.env.MASTYF_AI_DB_PATH = DB_PATH;
  process.env.MASTYF_AI_BLOCK_ON_CVE = 'false';
  process.env.MASTYF_AI_SKIP_PREFLIGHT_SCAN = 'true';

  const summary = {
    dbPath: DB_PATH,
    phases: {},
    corpus: { total: CORPUS.calls.length, ok: 0, fail: 0, results: [] },
    startedAt: new Date().toISOString(),
  };

  // Phase 1 — scan (persists security_scans for TUI Security tab)
  banner('PHASE 1 — Security scan → DB');
  const scan = runCli(['scan', '-c', join(SCENARIO, 'mcp-config.json')], baseEnv);
  summary.phases.scan = { exitCode: scan.code };
  log(scan.stdout || scan.stderr);
  if (scan.code !== 0) log(`[warn] scan exit ${scan.code}`);

  // Phase 2 — in-process proxy corpus
  banner('PHASE 2 — Proxy corpus (21 agent tool calls)');
  const { McpProxyServer } = require(join(ROOT, 'dist/proxy/proxy-server.js'));
  const { HistoryDatabase } = require(join(ROOT, 'dist/database/history-db.js'));
  const { PolicyEngine } = require(join(ROOT, 'dist/policy/policy-engine.js'));
  const { load } = require('js-yaml');

  const db = new HistoryDatabase(DB_PATH);
  const policyConfig = load(readFileSync(POLICY, 'utf8'));
  policyConfig.policy.mode = 'block';
  const engine = new PolicyEngine(policyConfig);

  const proxies = SERVER_NAMES.map((name) => ({
    name,
    proxy: new McpProxyServer(
      'node',
      [LOCAL_SERVICE],
      { PATH: process.env.PATH, HOME: process.env.HOME, SERVICE_ROLE: name },
      db,
      name,
      engine,
    ),
  }));
  await sleep(1200);

  const rpcOut = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (chunk, enc, cb) {
    for (const line of chunk.toString().split('\n')) {
      const t = line.trim();
      if (!t || t[0] !== '{') continue;
      try {
        const m = JSON.parse(t);
        if (m.id !== undefined && (m.result || m.error)) rpcOut.push(m);
      } catch (_) {}
    }
    return origWrite(chunk, enc, cb);
  };

  for (const call of CORPUS.calls) {
    const px = proxies.find((p) => p.name === call.server);
    if (!px) continue;
    await px.proxy.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: call.id,
        method: 'tools/call',
        params: { name: call.tool, arguments: call.arguments },
      }),
    );
    await sleep(80);
    const resp = rpcOut.find((m) => String(m.id) === String(call.id));
    const actual = resp?.error ? 'block' : resp?.result ? 'pass' : 'unknown';
    const rule = resp?.error?.data?.rule || null;
    const ok = actual === call.expect;
    if (ok) summary.corpus.ok++;
    else summary.corpus.fail++;
    summary.corpus.results.push({
      id: call.id,
      server: call.server,
      tool: call.tool,
      expect: call.expect,
      actual,
      rule,
      ok,
    });
    log(`  ${ok ? '✓' : '✗'} ${call.id} ${call.server}/${call.tool} → ${actual} ${rule ? `(${rule})` : ''}`);
  }
  process.stdout.write = origWrite;
  proxies.forEach((p) => p.proxy.kill());
  await sleep(400);

  // Phase 3 — health
  banner('PHASE 3 — Health check → DB');
  const health = runCli(
    ['health', '-c', join(SCENARIO, 'mcp-config-proxies.json'), '-f', 'json'],
    baseEnv,
  );
  summary.phases.health = { exitCode: health.code };
  log(health.stdout.slice(0, 800) || health.stderr.slice(0, 400));

  // Phase 4 — audit
  banner('PHASE 4 — Cost audit → DB');
  const audit = runCli(['audit', '-c', join(SCENARIO, 'mcp-config-proxies.json')], baseEnv);
  summary.phases.audit = { exitCode: audit.code };
  log(audit.stdout || audit.stderr);

  // Ledger stats
  const allRecords = [];
  for (const name of SERVER_NAMES) {
    allRecords.push(...(await db.getCallRecordsForServer(name)));
  }
  const blocked = allRecords.filter((r) => r.blocked);
  const forwarded = allRecords.filter((r) => !r.blocked && r.responseTokens > 0);
  summary.observability = {
    callRecords: allRecords.length,
    forwarded: forwarded.length,
    blocked: blocked.length,
    totalTokens: allRecords.reduce((s, r) => s + (r.totalTokens || 0), 0),
  };
  db.close();

  writeFileSync(join(MASTYF_AI_DIR, 'e2e-tui-summary.json'), JSON.stringify(summary, null, 2));

  banner('E2E SUMMARY');
  log(`  DB: ${DB_PATH}`);
  log(`  Corpus: ${summary.corpus.ok}/${summary.corpus.total} OK (${summary.corpus.fail} mismatches)`);
  log(
    `  Ledger: ${summary.observability.callRecords} calls, ${summary.observability.blocked} blocked, ${summary.observability.totalTokens} tokens`,
  );
  log(`  Scan/health/audit: ${summary.phases.scan?.exitCode}/${summary.phases.health?.exitCode}/${summary.phases.audit?.exitCode}`);
  log(`  Summary JSON: ${join(MASTYF_AI_DIR, 'e2e-tui-summary.json')}`);

  if (summary.corpus.fail > 0) {
    log('\n  ⚠ Some corpus calls did not match expectations — TUI will still show data.');
  }

  if (LAUNCH_TUI) {
    log('\n  Launching TUI (Ctrl+C to exit, Tab/1-8 tabs, r=refresh)...\n');
    await sleep(500);
    const child = spawn('node', [CLI, 'tui', '--policy', POLICY], {
      cwd: ROOT,
      env: { ...process.env, MASTYF_AI_DB_PATH: DB_PATH, MASTYF_AI_POLICY_PATH: POLICY },
      stdio: 'inherit',
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    log('\n  Run TUI:  node dist/cli.js tui --policy default-policy.yaml');
    log('  Or:       pnpm run tui\n');
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
