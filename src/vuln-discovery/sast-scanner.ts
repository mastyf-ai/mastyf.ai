/**
 * Optional Semgrep / heuristic SAST for MCP server package sources.
 * Falls back to lightweight pattern scan when Semgrep is not installed.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Logger } from '../utils/logger.js';
import type { McpServerConfig } from '../types.js';
import { resolveServerPackageRoot } from './sbom.js';
import {
  createFindingId,
  fingerprintFinding,
  getFinding,
  upsertFinding,
} from './store.js';
import type { VulnFinding, VulnSeverity } from './types.js';

const HEURISTIC_RULES: Array<{
  id: string;
  pattern: RegExp;
  severity: VulnSeverity;
  title: string;
}> = [
  {
    id: 'unsafe-eval',
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    severity: 'HIGH',
    title: 'Unsafe eval / Function constructor',
  },
  {
    id: 'child-process-shell',
    pattern: /exec\s*\(|execSync\s*\(|spawn\s*\([^)]*shell\s*:\s*true/,
    severity: 'HIGH',
    title: 'Shell execution without clear sanitization',
  },
  {
    id: 'path-join-user',
    pattern: /path\.join\s*\([^)]*req\.|path\.resolve\s*\([^)]*args/,
    severity: 'MEDIUM',
    title: 'Path join with request/args input (possible traversal)',
  },
  {
    id: 'hardcoded-secret',
    pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i,
    severity: 'CRITICAL',
    title: 'Possible hardcoded secret in source',
  },
  {
    id: 'disable-tls',
    pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|rejectUnauthorized\s*:\s*false/,
    severity: 'HIGH',
    title: 'TLS verification disabled',
  },
];

function upsertFindingLocal(
  partial: Omit<VulnFinding, 'id' | 'discoveredAt' | 'fingerprint'>,
): VulnFinding {
  const fp = fingerprintFinding({
    class: partial.class,
    target: partial.target,
    title: partial.title,
    evidence: { scanner: partial.evidence.scanner, reproSteps: partial.evidence.reproSteps },
  });
  const id = createFindingId(fp);
  const existing = getFinding(id);
  return upsertFinding({
    ...partial,
    id,
    fingerprint: fp,
    discoveredAt: existing?.discoveredAt || new Date().toISOString(),
    status: existing?.status === 'validated' ? existing.status : partial.status,
    validatedAt: existing?.validatedAt,
    analysisReportId: existing?.analysisReportId,
  });
}

function walkSourceFiles(root: string, maxFiles = 200): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'coverage') continue;
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (['.js', '.ts', '.mjs', '.cjs', '.py'].includes(extname(name))) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out;
}

function runHeuristicSast(root: string, serverName: string): VulnFinding[] {
  const findings: VulnFinding[] = [];
  for (const file of walkSourceFiles(root)) {
    let text: string;
    try {
      text = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (const rule of HEURISTIC_RULES) {
      for (let i = 0; i < lines.length; i++) {
        if (rule.pattern.test(lines[i])) {
          findings.push(
            upsertFindingLocal({
              class: rule.id === 'hardcoded-secret' ? 'config' : 'implementation',
              severity: rule.severity,
              status: 'candidate',
              title: `SAST: ${rule.title} in ${serverName}`,
              description: `${file}:${i + 1} matched ${rule.id}`,
              target: { kind: 'mcp_server', name: serverName },
              evidence: {
                scanner: 'sast-heuristic',
                reproSteps: [`Open ${file} line ${i + 1}`, `Pattern: ${rule.id}`],
                stackTrace: `${file}:${i + 1}: ${lines[i].trim().slice(0, 200)}`,
              },
              exploitability: {
                preAuth: true,
                networkReachable: true,
                userInteraction: false,
              },
            }),
          );
          break; // one hit per rule per file
        }
      }
    }
  }
  return findings;
}

function runSemgrep(root: string, serverName: string): VulnFinding[] | null {
  if (process.env.MASTYF_AI_VULN_DISCOVERY_SAST === 'off') return [];
  try {
    execSync('semgrep --version', { stdio: 'pipe', timeout: 5000 });
  } catch {
    return null; // not installed
  }
  try {
    const out = execSync(
      `semgrep --config=auto --json --quiet --timeout=30 "${root}"`,
      { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024, timeout: 120_000, stdio: 'pipe' },
    );
    const parsed = JSON.parse(out) as {
      results?: Array<{
        check_id: string;
        path: string;
        start?: { line: number };
        extra?: { severity?: string; message?: string };
      }>;
    };
    const findings: VulnFinding[] = [];
    for (const r of parsed.results || []) {
      const sev = (r.extra?.severity || 'WARNING').toUpperCase();
      findings.push(
        upsertFindingLocal({
          class: 'implementation',
          severity: mapSemgrepSeverity(sev),
          status: 'candidate',
          title: `Semgrep: ${r.check_id}`,
          description: r.extra?.message || r.check_id,
          target: { kind: 'mcp_server', name: serverName },
          evidence: {
            scanner: 'semgrep',
            reproSteps: [`${r.path}:${r.start?.line || '?'}`, r.check_id],
            stackTrace: `${r.path}:${r.start?.line || 0}`,
          },
          exploitability: {
            preAuth: true,
            networkReachable: true,
            userInteraction: false,
          },
        }),
      );
    }
    return findings;
  } catch (err) {
    Logger.warn(`[vuln:sast] Semgrep failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function mapSemgrepSeverity(s: string): VulnSeverity {
  if (s === 'ERROR' || s === 'CRITICAL') return 'CRITICAL';
  if (s === 'WARNING' || s === 'HIGH') return 'HIGH';
  if (s === 'INFO') return 'LOW';
  return 'MEDIUM';
}

export async function scanServerSast(server: McpServerConfig): Promise<VulnFinding[]> {
  const root = resolveServerPackageRoot(server);
  if (!root || !existsSync(root)) {
    Logger.debug(`[vuln:sast] No package root for ${server.name}`);
    return [];
  }
  const prefer = process.env.MASTYF_AI_VULN_DISCOVERY_SAST || 'semgrep';
  if (prefer === 'semgrep' || prefer === 'auto') {
    const sem = runSemgrep(root, server.name);
    if (sem !== null) return sem;
  }
  return runHeuristicSast(root, server.name);
}
