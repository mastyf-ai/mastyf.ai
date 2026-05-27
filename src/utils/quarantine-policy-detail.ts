/**
 * Resolve quarantine policy detail: triggered block context + applied YAML rule.
 */
import type { PolicyRule } from '../policy/policy-types.js';
import { findPolicyRuleByName } from '../ai/policy-applier.js';
import { ThreatIntel, type ThreatIntelEntry, type ThreatIntelQuarantineRecord } from '../ai/threat-intel.js';
import type { IDatabase } from '../database/database-interface.js';
import {
  buildQuarantineRule,
  resolveMonitorThreatContext,
} from './monitor-quarantine-enforcement.js';
import type { SecurityQuarantineRecord } from './security-threat-quarantine.js';

export type QuarantineTriggeredDetail = {
  kind: 'proxy_block' | 'semantic_flag' | 'threat_intel';
  title: string;
  ruleName?: string;
  reason?: string;
  toolName?: string;
  serverName?: string;
  timestamp?: string;
  patterns?: string[];
  severity?: string;
  signature?: string;
  affectedPackage?: string;
  affectedPattern?: string;
  semanticLabel?: string | null;
  semanticConfidence?: number;
  argumentsSnapshot?: Record<string, unknown>;
};

export type QuarantinePolicyDetail = {
  source: 'monitor' | 'intel';
  id: string;
  threatKey?: string;
  policyPath?: string;
  quarantine: {
    quarantinedAt: string;
    operator?: string;
    note?: string;
    appliedRuleName?: string;
    enforcementStatus?: string;
    enforcementDetail?: string;
    sourceKind?: string;
  };
  triggered: QuarantineTriggeredDetail | null;
  appliedRule: PolicyRule | null;
  suggestedRule: PolicyRule | null;
};

function intelEntryFromRecord(record: ThreatIntelQuarantineRecord): ThreatIntelEntry {
  return {
    id: record.id,
    source: record.source,
    severity: record.severity,
    description: record.description,
    remediation: record.remediation,
    publishedAt: record.publishedAt,
    affectedPackage: record.affectedPackage,
    affectedPattern: record.affectedPattern,
    signature: record.signature,
  };
}

function pickSuggestedIntelRule(
  record: ThreatIntelQuarantineRecord,
): PolicyRule | null {
  const ti = new ThreatIntel();
  const suggestions = ti.generateRules([intelEntryFromRecord(record)]);
  if (!suggestions.length) return null;
  if (record.appliedRuleName) {
    const match = suggestions.find((s) => s.rule.name === record.appliedRuleName);
    if (match) return match.rule;
  }
  return (
    suggestions.find((s) => s.rule.action === 'block')?.rule
    ?? suggestions[0]?.rule
    ?? null
  );
}

export async function buildMonitorQuarantinePolicyDetail(
  record: SecurityQuarantineRecord,
  tenantId: string | undefined,
  db: IDatabase | null,
): Promise<QuarantinePolicyDetail> {
  const policyPath = record.policyPath;
  const context = await resolveMonitorThreatContext(record, tenantId, db);
  const built = buildQuarantineRule(context);

  let triggered: QuarantineTriggeredDetail | null = null;
  if (context.sourceKind === 'block') {
    triggered = {
      kind: 'proxy_block',
      title: record.type || 'Proxy block',
      ruleName: context.record.blockRule || undefined,
      reason: context.record.blockReason || undefined,
      toolName: context.record.toolName,
      serverName: context.record.serverName,
      timestamp: String(context.record.timestamp || ''),
      patterns: context.record.blockRule ? [context.record.blockRule] : undefined,
      severity: record.severity,
    };
  } else if (context.sourceKind === 'semantic') {
    triggered = {
      kind: 'semantic_flag',
      title: record.type || 'Semantic flag',
      ruleName: context.semantic.syncDecision?.rule,
      reason: context.semantic.syncDecision?.reason,
      toolName: context.semantic.toolName,
      serverName: context.semantic.serverName,
      timestamp: context.semantic.timestamp,
      semanticLabel: context.semantic.label ?? null,
      semanticConfidence: context.semantic.semanticAudit?.confidence,
      argumentsSnapshot: context.semantic.argumentsSnapshot,
      severity: record.severity,
    };
  }

  const appliedRuleName = record.appliedRuleName;
  const appliedRule = appliedRuleName
    ? findPolicyRuleByName(appliedRuleName, policyPath)
    : null;

  return {
    source: 'monitor',
    id: record.id,
    threatKey: record.threatKey,
    policyPath,
    quarantine: {
      quarantinedAt: record.quarantinedAt,
      operator: record.operator,
      note: record.note,
      appliedRuleName,
      enforcementStatus: record.enforcementStatus,
      enforcementDetail: record.enforcementDetail,
      sourceKind: record.sourceKind,
    },
    triggered,
    appliedRule,
    suggestedRule: built.rule,
  };
}

export function buildIntelQuarantinePolicyDetail(
  record: ThreatIntelQuarantineRecord,
): QuarantinePolicyDetail {
  const policyPath = record.policyPath;
  const suggestedRule = pickSuggestedIntelRule(record);
  const appliedRuleName = record.appliedRuleName;
  const appliedRule = appliedRuleName
    ? findPolicyRuleByName(appliedRuleName, policyPath)
    : null;

  const triggered: QuarantineTriggeredDetail = {
    kind: 'threat_intel',
    title: record.description,
    severity: record.severity,
    signature: record.signature,
    affectedPackage: record.affectedPackage,
    affectedPattern: record.affectedPattern,
    ruleName: suggestedRule?.name,
    patterns: suggestedRule?.patterns,
    reason: `Threat intel ${record.source}: ${record.id}`,
  };

  return {
    source: 'intel',
    id: record.id,
    policyPath,
    quarantine: {
      quarantinedAt: record.quarantinedAt,
      operator: record.operator,
      note: record.note,
      appliedRuleName,
    },
    triggered,
    appliedRule,
    suggestedRule,
  };
}
