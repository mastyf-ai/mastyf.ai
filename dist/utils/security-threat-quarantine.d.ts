import type { SecurityThreatRow } from './security-dashboard.js';
export type SecurityQuarantineRecord = SecurityThreatRow & {
    threatKey: string;
    quarantinedAt: string;
    operator?: string;
    note?: string;
    appliedRuleName?: string;
    policyPath?: string;
    enforcementStatus: 'applied' | 'already_present' | 'already_blocked' | 'no_context' | 'skipped';
    enforcementDetail?: string;
    sourceKind: 'semantic' | 'block' | 'unknown';
};
export declare class SecurityThreatQuarantine {
    private tenantId;
    constructor(tenantId?: string);
    private read;
    isQuarantined(threatKey: string): boolean;
    quarantinedKeys(): Set<string>;
    quarantine(row: SecurityThreatRow & {
        threatKey: string;
    }, operator?: string, note?: string, meta?: {
        appliedRuleName?: string;
        policyPath?: string;
        enforcementStatus?: SecurityQuarantineRecord['enforcementStatus'];
        enforcementDetail?: string;
        sourceKind?: SecurityQuarantineRecord['sourceKind'];
    }): {
        ok: boolean;
        error?: string;
        record?: SecurityQuarantineRecord;
    };
    quarantineMany(rows: Array<SecurityThreatRow & {
        threatKey: string;
    }>, operator?: string): {
        ok: boolean;
        quarantined: number;
    };
    restore(threatKey: string): {
        ok: boolean;
        error?: string;
        record?: SecurityQuarantineRecord;
    };
    /**
     * Restore every quarantined row that shares type+source with the anchor threat.
     * Matches bulk quarantine, which archives all underlying rows for a fingerprint.
     */
    restoreGroup(threatKey: string): {
        ok: boolean;
        error?: string;
        records?: SecurityQuarantineRecord[];
        restored?: number;
    };
    list(days?: number): SecurityQuarantineRecord[];
    /** Resolve a quarantined row by stable threatKey and/or display id. */
    findEntry(days: number | undefined, opts: {
        threatKey?: string;
        id?: string;
    }): SecurityQuarantineRecord | undefined;
}
export declare function getSecurityThreatQuarantine(tenantId?: string): SecurityThreatQuarantine;
/** @internal test helper */
export declare function resetSecurityThreatQuarantineForTests(): void;
//# sourceMappingURL=security-threat-quarantine.d.ts.map