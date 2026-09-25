/**
 * Live security dashboard aggregation (video Feature 2).
 */
import type { IDatabase } from '../database/database-interface.js';
import { buildChartMeta } from './chart-meta.js';
import { getSecurityThreatQuarantine } from './security-threat-quarantine.js';
export type SecurityThreatRow = {
    id: string;
    /** Stable key for quarantine / restore (semantic audit id or block record fingerprint). */
    threatKey: string;
    type: string;
    source: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    status: 'blocked' | 'monitored' | 'resolved';
};
export type SecurityLayerStatus = {
    id: string;
    label: string;
    status: 'secure' | 'alert';
};
export type SecurityDashboardPayload = {
    available: boolean;
    windowDays: number;
    generatedAt: string;
    securityScore: number | null;
    scoreLabel: string;
    layers: SecurityLayerStatus[];
    executiveSummary: string[];
    threats: SecurityThreatRow[];
    activeThreatCount: number;
    quarantinedCount: number;
    semanticEngineActive: boolean;
    autoBlockOn: boolean;
    auditLatencyMs: number | null;
    rbacPolicy: string;
    meta: ReturnType<typeof buildChartMeta>;
    emptyReason?: string;
};
/** Stable UI grouping key — multiple block/semantic rows can share type+source. */
export declare function threatDisplayFingerprint(row: Pick<SecurityThreatRow, 'type' | 'source'>): string;
/** Matches dashboard time-window selector default (see DashboardWindowContext). */
export declare const DEFAULT_SECURITY_MONITOR_WINDOW = "7d";
/** All monitor threat rows before quarantine / dedupe (for bulk quarantine expansion). */
export declare function listMonitorThreatCandidates(db: IDatabase | null, tenantId: string | undefined, windowDaysInput: number | string): Promise<SecurityThreatRow[]>;
/** Related rows for single quarantine — must use the same window as the active dashboard. */
export declare function filterRelatedMonitorThreats(candidates: SecurityThreatRow[], anchor: SecurityThreatRow): SecurityThreatRow[];
export declare function listRelatedMonitorThreatsForQuarantine(db: IDatabase | null, tenantId: string | undefined, anchor: SecurityThreatRow, windowDaysInput?: number | string): Promise<SecurityThreatRow[]>;
/** High/critical rows to archive for quarantine-all — keyed by threatKey within the dashboard window. */
export declare function collectBulkQuarantineTargets(candidates: SecurityThreatRow[], visibleThreats: SecurityThreatRow[]): SecurityThreatRow[];
export declare function listBulkQuarantineTargets(db: IDatabase | null, tenantId: string | undefined, windowDaysInput?: number | string, policyMode?: string): Promise<SecurityThreatRow[]>;
/** @internal Exported for unit tests — dedupe + quarantine suppression. */
export declare function filterVisibleMonitorThreats(candidates: SecurityThreatRow[], quarantine: ReturnType<typeof getSecurityThreatQuarantine>): SecurityThreatRow[];
export declare function buildSecurityDashboard(db: IDatabase | null, tenantId: string | undefined, windowDaysInput: number | string, opts?: {
    policyMode?: string;
}): Promise<SecurityDashboardPayload>;
//# sourceMappingURL=security-dashboard.d.ts.map