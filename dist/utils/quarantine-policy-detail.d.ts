/**
 * Resolve quarantine policy detail: triggered block context + applied YAML rule.
 */
import type { PolicyRule } from '../policy/policy-types.js';
import { type ThreatIntelQuarantineRecord } from '../ai/threat-intel.js';
import type { IDatabase } from '../database/database-interface.js';
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
export declare function buildMonitorQuarantinePolicyDetail(record: SecurityQuarantineRecord, tenantId: string | undefined, db: IDatabase | null): Promise<QuarantinePolicyDetail>;
export declare function buildIntelQuarantinePolicyDetail(record: ThreatIntelQuarantineRecord): QuarantinePolicyDetail;
//# sourceMappingURL=quarantine-policy-detail.d.ts.map