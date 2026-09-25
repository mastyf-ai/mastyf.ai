import type { IDatabase } from '../database/database-interface.js';
import type { ProxyCallRecord } from '../types.js';
import type { PolicyRule } from '../policy/policy-types.js';
import type { PolicyWatcher } from '../policy/policy-watcher.js';
import type { SecurityThreatRow } from './security-dashboard.js';
import { type StoredSemanticAudit } from '../ai/semantic-audit-store.js';
export type MonitorEnforcementStatus = 'applied' | 'already_present' | 'already_blocked' | 'no_context' | 'skipped';
export type MonitorSourceKind = 'semantic' | 'block' | 'unknown';
type SemanticContext = {
    sourceKind: 'semantic';
    row: SecurityThreatRow;
    semantic: StoredSemanticAudit;
};
type BlockContext = {
    sourceKind: 'block';
    row: SecurityThreatRow;
    record: ProxyCallRecord;
};
type UnknownContext = {
    sourceKind: 'unknown';
    row: SecurityThreatRow;
};
export type MonitorThreatContext = SemanticContext | BlockContext | UnknownContext;
export declare function resolveMonitorThreatContext(row: SecurityThreatRow, tenantId: string | undefined, db: IDatabase | null): Promise<MonitorThreatContext>;
export declare function buildQuarantineRule(context: MonitorThreatContext): {
    rule: PolicyRule | null;
    confidence: number;
    detail: string;
};
export declare function applyMonitorQuarantineEnforcement(opts: {
    row: SecurityThreatRow;
    tenantId: string | undefined;
    db: IDatabase | null;
    policyPath: string;
    policyWatcher: PolicyWatcher | null;
    operator?: string;
}): Promise<{
    status: MonitorEnforcementStatus;
    sourceKind: MonitorSourceKind;
    appliedRuleName?: string;
    policyPath?: string;
    detail?: string;
}>;
export {};
//# sourceMappingURL=monitor-quarantine-enforcement.d.ts.map