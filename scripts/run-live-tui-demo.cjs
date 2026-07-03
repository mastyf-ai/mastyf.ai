#!/usr/bin/env node
/**
 * Live multi-server traffic into ~/.mastyf-ai/history.db for TUI verification.
 * No generated AI state — real proxy calls only.
 *
 * Usage:
 *   node scripts/run-live-tui-demo.cjs           # one-shot (all corpus calls)
 *   node scripts/run-live-tui-demo.cjs --stream  # one call every 1.5s (watch TUI update)
 */
const { readFileSync } = require('fs');
const { join, resolve } = require('path');
const { homedir } = require('os');

const ROOT = resolve(__dirname, '..');
const CORPUS = JSON.parse(readFileSync(join(ROOT, 'scenarios/dogfood/agent-corpus.json'), 'utf8'));
const LOCAL_SERVICE = join(ROOT, 'scenarios/dogfood/enterprise-mcp-local-service.cjs');
const POLICY = join(ROOT, 'default-policy.yaml');
const SERVER_NAMES = ['github', 'filesystem', 'puppeteer', 'postgres'];

const { McpProxyServer } = require(join(ROOT, 'dist/proxy/proxy-server.js'));
const { HistoryDatabase } = require(join(ROOT, 'dist/database/history-db.js'));
const { PolicyEngine } = require(join(ROOT, 'dist/policy/policy-engine.js'));
const { load } = require('js-yaml');
const { getAllActiveServerNames } = require(join(ROOT, 'dist/utils/db-aggregate.js'));

const stream = process.argv.includes('--stream');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendCall(proxy, call) {
  await proxy.handleClientInput(JSON.stringify({
    jsonrpc: '2.0',
    id: call.id,
    method: 'tools/call',
    params: { name: call.tool, arguments: call.arguments },
  }));
}

async function printDbSummary(db) {
  const servers = await getAllActiveServerNames(db);
  let total = 0;
  let blocked = 0;
  for (const name of servers) {
    const recs = await db.getCallRecordsForServer(name);
    const b = recs.filter((r) => r.blocked).length;
    total += recs.length;
    blocked += b;
    process.stdout.write(`  ${name}: ${recs.length} calls (${b} blocked)\n`);
  }
  process.stdout.write(`\n  DB: ${typeof db.getDbPath === 'function' ? db.getDbPath() : '(memory)'}\n`);
  process.stdout.write(`  Servers: ${servers.length} | Records: ${total} | Blocked: ${blocked}\n`);
}

(async function main() {
  const canonicalDb = join(homedir(), '.mastyf-ai', 'history.db');
  const db = new HistoryDatabase(canonicalDb);
  const effectiveDb = db.getDbPath();
  if (effectiveDb !== canonicalDb) {
    process.stderr.write(
      `\n⚠️  Demo DB path mismatch: expected ${canonicalDb}, got ${effectiveDb}\n\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`Writing to shared DB: ${effectiveDb}\n`);
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

  process.stdout.write('\n=== Live TUI demo — 4 MCP servers ===\n');
  process.stdout.write('Keep `pnpm run tui` open in another terminal.\n\n');
  await sleep(1000);

  const calls = CORPUS.calls;
  if (stream) {
    process.stdout.write(`Streaming ${calls.length} calls (1.5s apart)...\n\n`);
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const px = proxies.find((p) => p.name === call.server);
      if (!px) continue;
      await sendCall(px.proxy, call);
      process.stdout.write(`  [${i + 1}/${calls.length}] ${call.server}/${call.tool}\n`);
      await printDbSummary(db);
      process.stdout.write('\n');
      await sleep(1500);
    }
  } else {
    process.stdout.write(`Sending ${calls.length} calls...\n`);
    for (const call of calls) {
      const px = proxies.find((p) => p.name === call.server);
      if (!px) continue;
      await sendCall(px.proxy, call);
      await sleep(60);
    }
    process.stdout.write('\nDone.\n\n');
    await printDbSummary(db);
  }

  proxies.forEach((p) => p.proxy.kill());
  await sleep(300);
  db.close();
  process.stdout.write('\nTUI should show 4 servers on Instances tab and live counts on Overview/Audit.\n\n');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
