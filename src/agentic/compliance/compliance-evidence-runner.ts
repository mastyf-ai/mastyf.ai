/**
 * Compliance evidence runner — ControlMapper with live policy YAML + audit counts.
 */
import { readFileSync, existsSync } from 'fs';
import { load } from 'js-yaml';
import { ControlMapper, type ComplianceFramework, type CompliancePosture } from './control-mapper.js';
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { IDatabase } from '../../database/database-interface.js';
import type { ProxyCallRecord, SecurityReport } from '../../types.js';

export interface ComplianceEvidenceBundle {
  framework: ComplianceFramework;
  posture: CompliancePosture;
  policyPath: string;
  policySignals: Array<{ name: string; description?: string; action?: string; enabled: boolean }>;
  incidentSignals: string[];
  auditCounts: {
    totalCalls: number;
    blockedCalls: number;
    servers: string[];
    byServer: Array<{ serverName: string; totalCalls: number; blockedCalls: number }>;
    securityScans: Array<{ serverName: string; score: number; cveCount: number; recommendations: string[] }>;
    recentBlocked: Array<{
      serverName: string;
      toolName: string;
      blockRule?: string;
      blockReason?: string;
      timestamp: string;
      argumentSnippet?: string;
    }>;
  };
  generatedAt: string;
}

function defaultPolicyPath(): string {
  return process.env.MASTYF_AI_POLICY_PATH || process.env.MASTYF_AI_POLICY_PATH || 'default-policy.yaml';
}

function extractPolicySignals(policyPath: string): ComplianceEvidenceBundle['policySignals'] {
  if (!existsSync(policyPath)) return [];
  try {
    const raw = load(readFileSync(policyPath, 'utf-8')) as {
      policy?: { rules?: Array<{ name?: string; description?: string; action?: string; enabled?: boolean }> };
    };
    const rules = raw.policy?.rules ?? [];
    return rules.map((rule) => ({
      name: rule.name ?? 'unnamed-rule',
      description: rule.description,
      action: rule.action,
      enabled: rule.enabled !== false,
    }));
  } catch {
    return [];
  }
}

function policyTokens(signals: ComplianceEvidenceBundle['policySignals']): string[] {
  return signals
    .filter((signal) => signal.enabled)
    .flatMap((signal) => [signal.name, signal.description, signal.action].filter((value): value is string => Boolean(value)));
}

async function collectAuditCounts(db: IDatabase, tenantId = 'default'): Promise<ComplianceEvidenceBundle['auditCounts']> {
  const servers = await db.getDistinctActiveServers(tenantId);
  let totalCalls = 0;
  let blockedCalls = 0;
  const byServer: ComplianceEvidenceBundle['auditCounts']['byServer'] = [];
  const securityScans: ComplianceEvidenceBundle['auditCounts']['securityScans'] = [];
  const recentBlocked: ComplianceEvidenceBundle['auditCounts']['recentBlocked'] = [];
  for (const server of servers.slice(0, 20)) {
    const records = await db.getCallRecordsForServer(server, 100, tenantId);
    const serverBlocked = records.filter((r: ProxyCallRecord) => r.blocked === true);
    totalCalls += records.length;
    blockedCalls += serverBlocked.length;
    byServer.push({ serverName: server, totalCalls: records.length, blockedCalls: serverBlocked.length });
    for (const record of serverBlocked.slice(0, 5)) {
      recentBlocked.push({
        serverName: record.serverName,
        toolName: record.toolName,
        blockRule: record.blockRule,
        blockReason: record.blockReason,
        timestamp: record.timestamp,
        argumentSnippet: record.argumentSnippet,
      });
    }
    const scan = await db.getLatestSecurityScan(server, tenantId).catch(() => null);
    if (scan && typeof scan === 'object') {
      const report = scan as Partial<SecurityReport>;
      securityScans.push({
        serverName: server,
        score: typeof report.score === 'number' ? report.score : 0,
        cveCount: Array.isArray(report.cves) ? report.cves.length : 0,
        recommendations: Array.isArray(report.recommendations) ? report.recommendations.slice(0, 5) : [],
      });
    }
  }
  recentBlocked.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return { totalCalls, blockedCalls, servers, byServer, securityScans, recentBlocked: recentBlocked.slice(0, 12) };
}

export class ComplianceEvidenceRunner {
  private mapper = new ControlMapper();

  constructor(
    private readonly db: IDatabase,
    private readonly store?: IndustryStandardStore,
  ) {}

  async run(framework: ComplianceFramework, policyPath = defaultPolicyPath()): Promise<ComplianceEvidenceBundle> {
    const policySignals = extractPolicySignals(policyPath);
    const activePolicies = policyTokens(policySignals);
    const auditCounts = await collectAuditCounts(this.db);
    const blockedIncidents = [
      'shell_injection',
      'path_traversal',
      'prompt_injection',
      'credential_leak',
      auditCounts.blockedCalls > 0 ? 'incident' : '',
      auditCounts.blockedCalls > 0 ? 'respond' : '',
      auditCounts.totalCalls > 0 ? 'event' : '',
      auditCounts.totalCalls > 0 ? 'logging' : '',
      auditCounts.totalCalls > 0 ? 'audit' : '',
      auditCounts.securityScans.length > 0 ? 'vulnerability' : '',
      auditCounts.securityScans.length > 0 ? 'cve' : '',
      auditCounts.securityScans.length > 0 ? 'scan' : '',
      activePolicies.some(p => /audit|log/i.test(p)) ? 'audit' : '',
      activePolicies.some(p => /webhook|alert/i.test(p)) ? 'webhook' : '',
    ].filter(Boolean);

    const posture = this.mapper.evaluate(framework, activePolicies, blockedIncidents);
    const generatedAt = new Date().toISOString();

    for (const control of posture.controls) {
      this.store?.saveComplianceControlStatus({
        framework,
        controlId: control.controlId,
        status: control.satisfied ? 'satisfied' : 'gap',
        evidenceJson: JSON.stringify({
          satisfiedBy: control.satisfiedBy,
          gap: control.gap,
          auditCounts,
          policyPath,
          policySignals,
          incidentSignals: blockedIncidents,
        }),
        evaluatedAt: generatedAt,
      });
    }

    return { framework, posture, policyPath, policySignals, incidentSignals: blockedIncidents, auditCounts, generatedAt };
  }
}
