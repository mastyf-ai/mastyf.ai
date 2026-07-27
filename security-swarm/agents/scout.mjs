#!/usr/bin/env node
/**
 * Scout agent — dependency audit for mastyf itself + per-server fleet supply-chain signal.
 * No mocks. Emits scout.json for gates; optional fleet findings vs baseline.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..', '..');
const OUT_DIR = join(REPO, 'reports', 'security-swarm');
const BASELINE_PATH = join(__dir, '..', 'config', 'scout-baseline.json');

mkdirSync(OUT_DIR, { recursive: true });

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { criticalFingerprints: [] };
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
  } catch {
    return { criticalFingerprints: [] };
  }
}

// Audit runtime/production deps only for swarm gating. Dev-tool advisories
// (e.g. test runners) are tracked separately and should not fail live gates.
const r = spawnSync('pnpm', ['audit', '--prod', '--audit-level=high', '--json'], {
  cwd: REPO,
  encoding: 'utf-8',
  env: process.env,
});

let audit = { ok: false, status: r.status, advisories: [], summary: undefined, parseError: undefined };
try {
  const parsed = JSON.parse(r.stdout || '{}');
  const meta = parsed.metadata?.vulnerabilities || {};
  audit.summary = meta;
  audit.ok = (meta.high || 0) === 0 && (meta.critical || 0) === 0;
} catch {
  audit.parseError = (r.stderr || r.stdout || '').slice(0, 2000);
  audit.ok = false;
}

/** Optional per-server fleet scan via VDE CLI (when enabled).
 * Opt-in via SWARM_SCOUT_FLEET only — do not inherit MASTYF_AI_VULN_DISCOVERY_ENABLED
 * from dashboard/product env (that path is slow and trips the 60s scout-audit timeout).
 * Full vuln discovery runs as its own swarm agent when configured.
 */
let fleet = { scanned: 0, findings: 0, newCritical: [], errors: [] };
const fleetEnabled = process.env.SWARM_SCOUT_FLEET === 'true';

if (fleetEnabled) {
  const serversPath =
    process.env.MASTYF_AI_SERVERS_JSON ||
    join(homedir(), '.mastyf-ai', 'servers.json');
  if (existsSync(serversPath)) {
    try {
      const raw = JSON.parse(readFileSync(serversPath, 'utf-8'));
      const servers = Array.isArray(raw) ? raw : Object.values(raw?.mcpServers || raw || {});
      fleet.scanned = servers.length;
      const run = spawnSync(
        'pnpm',
        ['exec', 'tsx', 'src/cli.ts', 'vuln', 'run', '--supply-chain-only'],
        {
          cwd: REPO,
          encoding: 'utf-8',
          env: {
            ...process.env,
            MASTYF_AI_VULN_DISCOVERY_ENABLED: 'true',
            MASTYF_AI_VULN_DISCOVERY_ALLOWLIST:
              process.env.MASTYF_AI_VULN_DISCOVERY_ALLOWLIST || 'localhost,127.0.0.1',
            MASTYF_AI_VULN_SKIP_AUDIT: process.env.MASTYF_AI_VULN_SKIP_AUDIT || 'false',
          },
          timeout: 120_000,
        },
      );
      if (run.status !== 0) {
        fleet.errors.push((run.stderr || run.stdout || 'vuln run failed').slice(0, 500));
      }
      const findingsPath = join(homedir(), '.mastyf-ai', 'vuln-findings.jsonl');
      if (existsSync(findingsPath)) {
        const lines = readFileSync(findingsPath, 'utf-8').split('\n').filter(Boolean);
        const findings = lines.map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        }).filter(Boolean);
        fleet.findings = findings.length;
        const baseline = loadBaseline();
        const known = new Set(baseline.criticalFingerprints || []);
        fleet.newCritical = findings
          .filter(
            (f) =>
              f.severity === 'CRITICAL' &&
              f.status !== 'rejected' &&
              !known.has(f.fingerprint || f.id),
          )
          .map((f) => f.fingerprint || f.id);
      }
    } catch (e) {
      fleet.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
}

const fleetOk =
  !fleetEnabled ||
  fleet.newCritical.length === 0 ||
  process.env.SWARM_SCOUT_ALLOW_NEW_CRITICAL === 'true';

const out = {
  agent: 'scout',
  timestamp: new Date().toISOString(),
  audit,
  fleet,
  ok: audit.ok && fleetOk,
};

writeFileSync(join(OUT_DIR, 'scout.json'), JSON.stringify(out, null, 2));
console.log(`[scout] dependency audit: ${audit.ok ? 'PASS' : 'FAIL'}`);
if (audit.summary) {
  console.log(
    `[scout] critical=${audit.summary.critical ?? 0} high=${audit.summary.high ?? 0} moderate=${audit.summary.moderate ?? 0} low=${audit.summary.low ?? 0}`,
  );
}
if (fleetEnabled) {
  console.log(
    `[scout] fleet scanned=${fleet.scanned} findings=${fleet.findings} newCritical=${fleet.newCritical.length}`,
  );
}
// High/moderate advisories are reported via scout.json + synthesizer findings.
// Only hard-fail the step on parse errors or unexpected new fleet CRITICAL items
// (keeps scout-audit off the critical step-failure path for known prod highs).
const hardFail = Boolean(audit.parseError) || !fleetOk;
process.exit(hardFail ? 1 : 0);
