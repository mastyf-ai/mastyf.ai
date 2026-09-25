/**
 * Policy Audit Trail — records every policy change for compliance.
 * Logs: who changed what, when, old/new values, and rollback info.
 * Enable with: POLICY_AUDIT_ENABLED=true
 */
export interface PolicyChangeRecord {
    timestamp: string;
    actor: string;
    change: string;
    oldValue?: string;
    newValue?: string;
    sourceHash?: string;
    residency_region?: string;
}
export declare class PolicyAuditor {
    private auditPath;
    private enabled;
    private lastHash;
    constructor(auditPath?: string, tenantId?: string);
    record(change: PolicyChangeRecord): void;
    readAuditTrail(): PolicyChangeRecord[];
    computeHash(content: string): string;
    hasChanged(content: string): boolean;
}
//# sourceMappingURL=policy-auditor.d.ts.map