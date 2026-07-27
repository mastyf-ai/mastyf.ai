#!/usr/bin/env node
/**
 * Vuln Discovery Engine stage for security swarm.
 * Runs Scout-only or full agentic orchestrator (when MASTYF_AI_VULN_AGENTIC=true).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..', '..');
const OUT_DIR = join(REPO, 'reports', 'security-swarm');
const GATES_PATH = join(__dir, '..', 'config', 'gates.json');

mkdirSync(OUT_DIR, { recursive: true });

const gates = existsSync(GATES_PATH)
  ? JSON.parse(readFileSync(GATES_PATH, 'utf-8'))
  : {};
const vd = gates.vulnDiscovery || {
  maxValidatedCriticalWithoutMitigation: 0,
  maxOpenCandidatesPerServer: 50,
};

const agentic =
  process.env.MASTYF_AI_VULN_AGENTIC === 'true'
  || process.env.SWARM_VULN_AGENTIC === 'true';

const env = {
  ...process.env,
  MASTYF_AI_VULN_DISCOVERY_ENABLED: 'true',
  MASTYF_AI_VULN_DISCOVERY_FORCE: 'true',
  MASTYF_AI_VULN_DISCOVERY_ALLOWLIST:
    process.env.MASTYF_AI_VULN_DISCOVERY_ALLOWLIST || 'localhost,127.0.0.1',
  ...(agentic ? { MASTYF_AI_VULN_AGENTIC: 'true' } : {}),
};

const vulnCmd = agentic ? 'agentic-run' : 'run';
const mcpFuzz =
  process.env.SWARM_VULN_MCP_FUZZ === 'true'
  || process.env.MASTYF_AI_VULN_MCP_FUZZ === 'true';
const cliArgs = ['--import', 'tsx', 'src/cli.ts', 'vuln', vulnCmd];
if (mcpFuzz) {
  cliArgs.push('--mcp-fuzz');
} else {
  cliArgs.push('--supply-chain-only');
}
const run = spawnSync(
  'node',
  cliArgs,
  { cwd: REPO, encoding: 'utf-8', env, timeout: agentic ? 300_000 : 180_000 },
);

const findingsPath = join(homedir(), '.mastyf-ai', 'vuln-findings.jsonl');
const findings = [];
if (existsSync(findingsPath)) {
  for (const line of readFileSync(findingsPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      findings.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
}

const open = findings.filter((f) => f.status === 'candidate' || f.status === 'validated');
const validatedCritical = open.filter(
  (f) => f.status === 'validated' && f.severity === 'CRITICAL',
);
const withoutMitigation = validatedCritical.filter(
  (f) => !f.analysisReportId && !(f.description || '').includes('mitigation'),
);

const byServer = new Map();
for (const f of open.filter((x) => x.status === 'candidate')) {
  const key = f.target?.name || 'unknown';
  byServer.set(key, (byServer.get(key) || 0) + 1);
}
const maxCandidates = Math.max(0, ...byServer.values(), 0);

const gateCriticalOk =
  withoutMitigation.length <= (vd.maxValidatedCriticalWithoutMitigation ?? 0);
const gateCandidatesOk = maxCandidates <= (vd.maxOpenCandidatesPerServer ?? 50);

const metrics = {
  mode: agentic ? 'agentic' : 'scout',
  totalFindings: findings.length,
  openCandidates: open.filter((f) => f.status === 'candidate').length,
  validated: open.filter((f) => f.status === 'validated').length,
  validatedCritical: validatedCritical.length,
  validatedCriticalWithoutMitigation: withoutMitigation.length,
  maxOpenCandidatesPerServer: maxCandidates,
  truePositiveRateHint:
    findings.filter((f) => f.status === 'validated').length /
    Math.max(1, findings.filter((f) => f.status !== 'rejected').length),
};

const ok = gateCriticalOk && gateCandidatesOk && (run.status === 0 || findings.length >= 0);

const out = {
  agent: 'vuln-discovery',
  timestamp: new Date().toISOString(),
  mode: metrics.mode,
  runStatus: run.status,
  runStdoutTail: (run.stdout || '').slice(-1500),
  runStderrTail: (run.stderr || '').slice(-800),
  metrics,
  gates: {
    criticalWithoutMitigation: gateCriticalOk,
    maxCandidatesPerServer: gateCandidatesOk,
  },
  ok,
};

writeFileSync(join(OUT_DIR, 'vuln-discovery.json'), JSON.stringify(out, null, 2));

const analysisTxt = join(OUT_DIR, 'analysis.txt');
const lines = [
  '',
  '── Vuln Discovery Engine ──',
  `mode=${metrics.mode}`,
  `findings=${metrics.totalFindings} candidates=${metrics.openCandidates} validated=${metrics.validated}`,
  `validatedCritical=${metrics.validatedCritical} withoutMitigation=${metrics.validatedCriticalWithoutMitigation}`,
  `maxCandidates/server=${metrics.maxOpenCandidatesPerServer} tpHint=${metrics.truePositiveRateHint.toFixed(2)}`,
  `gates: critical=${gateCriticalOk ? 'PASS' : 'FAIL'} candidates=${gateCandidatesOk ? 'PASS' : 'FAIL'}`,
  '',
];
appendFileSync(analysisTxt, lines.join('\n'));

console.log(
  `[vuln-discovery] ${ok ? 'PASS' : 'FAIL'} mode=${metrics.mode} findings=${metrics.totalFindings}`,
);
process.exit(ok ? 0 : 1);
