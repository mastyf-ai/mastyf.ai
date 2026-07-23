#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = process.env.REPORT_OUTPUT || path.join(process.cwd(), 'MCP_Mastyf_Ai_Report.txt');
const PROJECT = process.cwd();
const VERSION = JSON.parse(fs.readFileSync(path.join(PROJECT, 'package.json'), 'utf-8')).version;

function append(text) { fs.appendFileSync(OUT, text + '\n'); }
function header(text) { append('\n' + '='.repeat(80)); append(text); append('='.repeat(80)); }

// Initialize
fs.writeFileSync(OUT, '');
append('╔══════════════════════════════════════════════════════════════════════════════════════╗');
append('║  MASTYF AI v' + VERSION + ' — COMPREHENSIVE TEST & ANALYSIS REPORT' + ' '.repeat(Math.max(0, 67 - VERSION.length)) + '║');
append('║  Generated: ' + new Date().toISOString() + '                                           ║');
append('║  Repository: https://github.com/mastyf-ai/mastyf-ai                              ║');
append('║  npm: @mastyf_ai/server@' + VERSION + ' '.repeat(Math.max(0, 50 - VERSION.length)) + '║');
append('╚══════════════════════════════════════════════════════════════════════════════════════╝');

// 1. TypeScript Compile
header('SECTION 1: TYPESCRIPT COMPILATION');
try {
  execSync('npx tsc --noEmit', { cwd: PROJECT, stdio: 'pipe', timeout: 60000 });
  append('RESULT: ✓ ZERO TypeScript errors');
} catch (e) {
  append('RESULT: ✗ COMPILATION FAILED — ' + e.message);
}

// 2. Vitest Test Suite
header('SECTION 2: VITEST TEST SUITE');
try {
  const out = execSync('npx vitest run --reporter=verbose 2>&1', { cwd: PROJECT, maxBuffer: 1024*1024, encoding: 'utf-8', timeout: 120000 });
  append(out);
} catch (e) {
  append('TESTS FAILED: ' + e.message);
  append(e.stdout || '');
}

// 3. Security Scan
header('SECTION 3: SECURITY SCAN (live OSV.dev + NVD CVE data)');
const configPath = process.env.MCP_CONFIG ||
  path.join(process.env.HOME, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
try {
  const out = execSync(
    `node dist/cli.js scan --config "${configPath}" --json`,
    { cwd: PROJECT, encoding: 'utf-8', maxBuffer: 1024*1024, timeout: 120000 }
  );
  append(JSON.stringify(JSON.parse(out), null, 2));
} catch (e) {
  append('Scan failed — ' + e.message);
}

// 4. Cost Audit
header('SECTION 4: COST & TOKEN AUDIT');
try {
  const out = execSync(
    `node dist/cli.js audit --config "${configPath}"`,
    { cwd: PROJECT, encoding: 'utf-8', maxBuffer: 1024*1024, timeout: 60000 }
  );
  append(out);
} catch (e) {
  append('Audit failed — ' + e.message);
}

// 5. Health Report
header('SECTION 5: HEALTH REPORT');
try {
  const out = execSync(
    `node dist/cli.js health --config "${configPath}"`,
    { cwd: PROJECT, encoding: 'utf-8', maxBuffer: 1024*1024, timeout: 30000 }
  );
  append(out);
} catch (e) {
  append('Health check failed — ' + e.message);
}

// 6. Full Combined Report
header('SECTION 6: FULL COMBINED REPORT');
try {
  const out = execSync(
    `node dist/cli.js full-report --config "${configPath}" --policy ./default-policy.yaml`,
    { cwd: PROJECT, encoding: 'utf-8', maxBuffer: 1024*1024, timeout: 60000 }
  );
  append(out);
} catch (e) {
  append('Full report failed — ' + e.message);
}

// 7. Benchmark
header('SECTION 7: BENCHMARKS');
try {
  const out = execSync('npx tsx benchmarks/run.ts', { cwd: PROJECT, encoding: 'utf-8', timeout: 60000 });
  append(out);
} catch (e) {
  append('Benchmarks failed — ' + e.message);
}

// Footer
append('\n' + '='.repeat(80));
append('REPORT COMPLETE — ' + new Date().toISOString());
append('='.repeat(80));
console.log(`Report written to ${OUT}`);