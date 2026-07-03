#!/usr/bin/env node
/**
 * Live AI learning test — real proxy traffic only (no seed, no live OSV/health probes).
 * Finishes in ~30s. Avoids hang from scan + HealthMonitor.checkServer in learning cycle.
 */
const { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } = require('fs');
const { join, resolve } = require('path');
const { homedir } = require('os');

const ROOT = resolve(__dirname, '..');
const SCENARIO = join(ROOT, 'scenarios', 'dogfood');
const CORPUS = JSON.parse(readFileSync(join(SCENARIO, 'agent-corpus.json'), 'utf8'));
const POLICY = join(ROOT, 'default-policy.yaml');
const LOCAL_SERVICE = join(SCENARIO, 'enterprise-mcp-local-service.cjs');
const SERVER_NAMES = ['github', 'filesystem', 'puppeteer', 'postgres'];
const MASTYF_AI_DIR = join(homedir(), '.mastyf-ai');
const DB_PATH = join(MASTYF_AI_DIR, 'history-live-ai.db');
const AI_STATE = join(MASTYF_AI_DIR, '.ai-learning.json');
const QUICK = process.argv.includes('--quick');

const log = (m) => process.stdout.write(m + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readAiState() {
  if (!existsSync(AI_STATE)) return null;
  return JSON.parse(readFileSync(AI_STATE, 'utf8'));
}

(async function main() {
  log('\n══════════════════════════════════════════════════════════');
  log('  LIVE AI LEARNING TEST (real traffic, fast path)');
  log('══════════════════════════════════════════════════════════\n');

  mkdirSync(MASTYF_AI_DIR, { recursive: true });
  for (const f of [AI_STATE, DB_PATH, DB_PATH + '.pid']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }

  process.env.MASTYF_AI_DB_PATH = DB_PATH;
  process.env.MASTYF_AI_BLOCK_ON_CVE = 'false';
  process.env.MASTYF_AI_EXPERIMENTAL_AI = 'true';
  process.env.MASTYF_AI_AI_USE_DB_SNAPSHOTS = 'true';
  process.env.MASTYF_AI_AI_DISABLE_PERIODIC = 'true';
  process.env.MASTYF_AI_AI_DISABLE_THREAT_POLL = 'true';
  process.env.MASTYF_AI_AI_SKIP_INITIAL_CYCLE = 'true';
  process.env.MASTYF_AI_AI_AUTO_APPLY_THRESHOLD = '0.45';

  log('Phase A — Real proxy calls → DB');
  const { McpProxyServer } = require(join(ROOT, 'dist/proxy/proxy-server.js'));
  const { HistoryDatabase } = require(join(ROOT, 'dist/database/history-db.js'));
  const { PolicyEngine } = require(join(ROOT, 'dist/policy/policy-engine.js'));
  const { load } = require('js-yaml');

  const db = new HistoryDatabase(DB_PATH);
  const policyConfig = load(readFileSync(POLICY, 'utf8'));
  policyConfig.policy.mode = 'block';
  const policyEngine = new PolicyEngine(policyConfig);

  const proxies = SERVER_NAMES.map((name) => ({
    name,
    proxy: new McpProxyServer(
      'node', [LOCAL_SERVICE],
      { PATH: process.env.PATH, HOME: process.env.HOME, SERVICE_ROLE: name },
      db, name, policyEngine,
    ),
  }));
  await sleep(800);

  const rounds = QUICK ? 1 : 2;
  for (let round = 1; round <= rounds; round++) {
    for (const call of CORPUS.calls) {
      const px = proxies.find((p) => p.name === call.server);
      if (!px) continue;
      await px.proxy.handleClientInput(JSON.stringify({
        jsonrpc: '2.0', id: `${call.id}-r${round}`, method: 'tools/call',
        params: { name: call.tool, arguments: call.arguments },
      }));
      await sleep(10);
    }
  }

  if (!QUICK) {
    const gh = proxies.find((p) => p.name === 'github');
    for (let i = 0; i < 8; i++) {
      await gh.proxy.handleClientInput(JSON.stringify({
        jsonrpc: '2.0', id: `burst-${i}`, method: 'tools/call',
        params: {
          name: 'search',
          arguments: { query: i === 7 ? 'x'.repeat(4000) : `baseline probe ${i}` },
        },
      }));
      await sleep(10);
    }
  }

  proxies.forEach((p) => p.proxy.kill());
  await sleep(200);

  let records = [];
  for (const name of SERVER_NAMES) {
    records.push(...(await db.getCallRecordsForServer(name)));
  }
  log(`  ${records.length} call records\n`);

  log('Phase B — Learning cycles (DB snapshots only, no network scan)\n');
  const { initializeAiEngine } = require(join(ROOT, 'dist/ai/suggestion-engine.js'));
  const { ConfigParser } = require(join(ROOT, 'dist/config-parser.js'));
  const servers = ConfigParser.parse(join(SCENARIO, 'mcp-config-proxies.json'));

  const aiEngine = await initializeAiEngine(db, servers);
  aiEngine.stopPeriodicAnalysis();
  const cycle1 = await aiEngine.runLearningCycle();
  const cycle2 = await aiEngine.runLearningCycle();

  const baselines = aiEngine.getBaselineLearner().getAllBaselines();
  const after = readAiState();

  log(`  baselines=${baselines.length}`);
  log(`  cycle1: suggestions=${cycle1.suggestions.length} applied=${cycle1.autoApplied.length}`);
  log(`  cycle2: suggestions=${cycle2.suggestions.length} applied=${cycle2.autoApplied.length}`);
  log(`  outcomes=${after?.outcomes?.length ?? 0} threshold=${after?.adaptiveThreshold ?? '-'}`);

  if (cycle2.suggestions.length) {
    for (const s of cycle2.suggestions.slice(0, 5)) {
      log(`    • ${s.rule.name} [${s.source}] conf=${s.confidence.toFixed(2)}`);
    }
  }

  db.close();

  const ok = records.length >= 10 && baselines.length > 0;
  log(`\n${ok ? 'PASS' : 'FAIL'} — ${ok ? 'learning pipeline ran on live call data' : 'insufficient data'}`);
  log(`DB: ${DB_PATH}`);
  log(`State: ${AI_STATE}\n`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
