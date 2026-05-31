/**
 * Compliance evidence runner — ControlMapper with live policy YAML + audit counts.
 */
import { readFileSync, existsSync } from 'fs';
import { load } from 'js-yaml';
import { ControlMapper, type ComplianceFramework, type CompliancePosture } from './control-mapper.js';
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { IDatabase } from '../../database/database-interface.js';
import type { ProxyCallRecord } from '../../types.js';

export interface ComplianceEvidenceBundle {
  framework: ComplianceFramework;
  posture: CompliancePosture;
  policyPath: string;
  auditCounts: { totalCalls: number; blockedCalls: number; servers: string[] };
  generatedAt: string;
}

function defaultPolicyPath(): string {
  return process.env.GUARDIAN_POLICY_PATH || process.env.MCP_GUARDIAN_POLICY_PATH || 'default-policy.yaml';
}

function extractActivePolicies(policyPath: string): string[] {
  if (!existsSync(policyPath)) return [];
  try {
    const raw = load(readFileSync(policyPath, 'utf-8')) as {
      policy?: { rules?: Array<{ name?: string; description?: string; action?: string }> };
    };
    const rules = raw.policy?.rules ?? [];
    const tokens: string[] = [];
    for (const rule of rules) {
      if (rule.name) tokens.push(rule.name);
      if (rule.description) tokens.push(rule.description);
      if (rule.action) tokens.push(rule.action);
    }
    return tokens;
  } catch {
    return [];
  }
}

async function collectAuditCounts(db: IDatabase, tenantId = 'default'): Promise<ComplianceEvidenceBundle['auditCounts']> {
  const servers = await db.getDistinctActiveServers(tenantId);
  let totalCalls = 0;
  let blockedCalls = 0;
  for (const server of servers.slice(0, 20)) {
    const records = await db.getCallRecordsForServer(server, 100, tenantId);
    totalCalls += records.length;
    blockedCalls += records.filter((r: ProxyCallRecord) => r.blocked === true).length;
  }
  return { totalCalls, blockedCalls, servers };
}

export class ComplianceEvidenceRunner {
  private mapper = new ControlMapper();

  constructor(
    private readonly db: IDatabase,
    private readonly store?: IndustryStandardStore,
  ) {}

  async run(framework: ComplianceFramework, policyPath = defaultPolicyPath()): Promise<ComplianceEvidenceBundle> {
    const activePolicies = extractActivePolicies(policyPath);
    const auditCounts = await collectAuditCounts(this.db);
    const blockedIncidents = [
      'shell_injection',
      'path_traversal',
      'prompt_injection',
      'credential_leak',
      auditCounts.blockedCalls > 0 ? 'incident' : '',
      auditCounts.blockedCalls > 0 ? 'respond' : '',
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
        }),
        evaluatedAt: generatedAt,
      });
    }

    return { framework, posture, policyPath, auditCounts, generatedAt };
  }
}
