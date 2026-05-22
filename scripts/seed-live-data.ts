/** Seeds the HistoryDatabase with realistic proxy call records, security scans, cost/health data and AI state */
import { HistoryDatabase } from '../src/database/history-db.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

if (process.env.GUARDIAN_SEED_CONFIRM !== '1') {
  console.error('Refusing to seed demo data. Set GUARDIAN_SEED_CONFIRM=1 to run scripts/seed-live-data.ts');
  process.exit(1);
}

const db = new HistoryDatabase();
await db.initialize?.();

// Clean any corrupt entries 
const servers = await db.getDistinctScannedServers();
console.log(`Existing servers: ${servers.length}`);

// Seed realistic call records (simulating proxy traffic)
const now = Date.now();
const serverName = servers[0] || 'echo-test';
const tools = ['read_file', 'execute_command', 'write_to_file', 'search_files', 'use_mcp_tool', 'list_files', 'read_text_file', 'replace_in_file'];

for (let i = 0; i < 80; i++) {
  const toolName = tools[i % tools.length];
  const reqTokens = 200 + Math.floor(Math.random() * 3500);
  const resTokens = 50 + Math.floor(Math.random() * 1200);
  const duration = 15 + Math.floor(Math.random() * 350);
  const timestamp = new Date(now - (80 - i) * 60000).toISOString();

  await db.addCallRecord({
    serverName,
    toolName,
    requestTokens: reqTokens,
    responseTokens: resTokens,
    totalTokens: reqTokens + resTokens,
    durationMs: duration,
    timestamp,
  });
}

console.log('Seeded 80 call records');

// Seed security scans
await db.addSecurityScan(serverName, 70, 2, {
  cves: [{ severity: 'HIGH', id: 'CVE-2024-TEST-001' }, { severity: 'MEDIUM', id: 'CVE-2024-TEST-002' }],
  authStatus: { hasAuthentication: false },
  score: 70,
});

// Seed cost records
await db.addCostRecord(serverName, 250000, 0.035);
await db.addHealthCheck(serverName, 45, true, 3);

// Seed AI learning state
const aiStatePath = path.join(require('os').homedir(), '.mcp-guardian', '.ai-learning.json');
try {
  mkdirSync(dirname(aiStatePath), { recursive: true });
} catch {}
writeFileSync(aiStatePath, JSON.stringify({
  outcomes: [
    { suggestionId: 'baseline-0', ruleName: 'auto-token-cap-read_file', source: 'baseline', action: 'applied', confidence: 0.9, timestamp: new Date().toISOString() },
    { suggestionId: 'cost-1', ruleName: 'cost-burst-execute_command', source: 'cost', action: 'applied', confidence: 0.87, timestamp: new Date().toISOString() },
    { suggestionId: 'pattern-2', ruleName: 'auto-circuit-break-echo-test', source: 'pattern', action: 'rejected', confidence: 0.6, timestamp: new Date().toISOString() },
  ],
  truePositiveRate: 0.67,
  falsePositiveRate: 0.33,
  adaptiveThreshold: 0.82,
  moduleWeights: { baseline: 0.95, cost: 0.87, threat: 1.0, assist: 1.0 },
  lastUpdated: new Date().toISOString(),
}));
console.log('AI learning state seeded');

// Seed threat state with realistic data
const threatPath = path.join(require('os').homedir(), '.mcp-guardian', '.threat-state.json');
try { mkdirSync(dirname(threatPath), { recursive: true }); } catch {}
writeFileSync(threatPath, JSON.stringify({
  ids: [
    'osv-GHSA-345p-7cg4-v4c7',
    'osv-GHSA-8r9q-7v3j-jr4g',
    'osv-GHSA-w48q-cv73-mx4w',
    'gh-GHSA-r8j5-8747-88cm',
    'gh-GHSA-wf8q-wvv8-p8jf',
    'gh-GHSA-wx44-2q6h-j6p8',
    'gh-GHSA-96ff-gc8g-wpvg',
  ],
  updated: new Date().toISOString(),
}));
console.log('Threat state seeded (7 entries)');

// Verify data
const records = await db.getCallRecordsForServer(serverName);
console.log(`Verified: ${records.length} call records for ${serverName}`);
console.log(`Total tokens: ${records.reduce((s: number, r: any) => s + r.totalTokens, 0)}`);
console.log(`Avg latency: ${Math.round(records.reduce((s: number, r: any) => s + r.durationMs, 0) / records.length)}ms`);

db.close();
console.log('Seed complete. Restart TUI to see populated data.');