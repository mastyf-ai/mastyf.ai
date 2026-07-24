import { scanServer, scanTool, type ServerScanResult } from '@mastyf_ai/core';
import { fetchToolsFromStdio } from '@mastyf_ai/core/transports/stdio';
import type { TrustGrade } from '@mastyf_ai/tool-registry';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface PreflightReport {
  packageName: string;
  version: string;
  tools: number;
  findings: Array<{ tool: string; severity: string; description: string }>;
  risk: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  grade: TrustGrade;
  recommendations: string[];
  scannedAt: string;
}

function computeGrade(score: number): TrustGrade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

export async function preflightCheck(packageName: string): Promise<PreflightReport> {
  const info = JSON.parse(execSync(`npm view ${packageName} --json`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 }).trim());
  const version = info.version || 'unknown';

  const cacheDir = join(homedir(), '.mastyf-ai', 'preflight-cache');
  mkdirSync(cacheDir, { recursive: true });
  const cacheKey = `${packageName.replace(/\//g, '_')}-${version}.json`;
  const cachePath = join(cacheDir, cacheKey);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
    const age = Date.now() - new Date(cached.scannedAt).getTime();
    if (age < 24 * 3600_000) return cached;
  }

  const issues: PreflightReport['findings'] = [];

  if (info.dependencies) {
    for (const [dep, ver] of Object.entries(info.dependencies)) {
      if (dep.includes('child_process') || dep.includes('exec') || dep.includes('shell')) {
        issues.push({ tool: dep, severity: 'high', description: `Dependency ${dep}@${ver} can execute shell commands` });
      }
    }
  }

  if (info.maintainers && info.maintainers.length === 0) {
    issues.push({ tool: 'package', severity: 'medium', description: 'Package has no listed maintainers' });
  }

  if (info.bin) {
    const bins = typeof info.bin === 'string' ? [info.bin] : Object.values(info.bin);
    for (const bin of bins) {
      if (typeof bin === 'string' && (bin.includes('eval') || bin.includes('exec'))) {
        issues.push({ tool: 'bin', severity: 'high', description: 'CLI entrypoint contains dangerous patterns' });
      }
    }
  }

  const baseName = packageName.replace(/^@[^/]+\//, '');
  const knownTargets = ['playwright', 'puppeteer', 'filesystem', 'github', 'postgres', 'sqlite', 'memory', 'brave-search'];
  for (const target of knownTargets) {
    if (baseName !== target && levenshteinDistance(baseName, target) <= 2) {
      issues.push({ tool: 'package', severity: 'critical', description: `Possible typosquatting: "${baseName}" is 2 edits from trusted package "${target}"` });
    }
  }

  let toolsCount = 0;
  try {
    const serverScan = scanServer(packageName, [], 'stdio');
    const result = await serverScan;
    for (const toolResult of result.tools) {
      toolsCount++;
      for (const issue of toolResult.issues) {
        issues.push({ tool: toolResult.toolName, severity: issue.severity, description: issue.message });
      }
    }
  } catch {
    // scanServer may fail if tools array is empty — ignore
  }

  const totalIssues = issues.length;
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const highCount = issues.filter(i => i.severity === 'high').length;

  let score = 100;
  score -= criticalCount * 25;
  score -= highCount * 10;
  score -= Math.max(0, totalIssues - criticalCount - highCount) * 3;
  score = Math.max(0, Math.min(100, score));

  const grade = computeGrade(score);

  let risk: PreflightReport['risk'] = 'low';
  if (criticalCount > 0) risk = 'critical';
  else if (highCount > 1 || score < 50) risk = 'high';
  else if (score < 75) risk = 'medium';

  const recommendations: string[] = [];
  if (criticalCount > 0) recommendations.push(`FIX NOW: ${criticalCount} critical issues found — do not install without review`);
  if (highCount > 0) recommendations.push(`Review ${highCount} high-severity findings before using in production`);
  if (!info.repository) recommendations.push('This package has no public repository — cannot verify source code');

  const report: PreflightReport = {
    packageName,
    version,
    tools: toolsCount,
    findings: issues,
    risk,
    score,
    grade,
    recommendations,
    scannedAt: new Date().toISOString(),
  };

  writeFileSync(cachePath, JSON.stringify(report, null, 2), 'utf-8');

  return report;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
