export type ThreatDiscoveryJobKind = 'threat-lab' | 'auto-research';
export declare function threatDiscoveryJobPath(kind: ThreatDiscoveryJobKind, tenantId?: string): string;
export declare function threatDiscoveryLogPath(kind: ThreatDiscoveryJobKind, tenantId?: string): string;
export declare function loadThreatDiscoveryJob(kind: ThreatDiscoveryJobKind, tenantId?: string): Record<string, unknown> | null;
export declare function patchThreatDiscoveryJob(kind: ThreatDiscoveryJobKind, patch: Record<string, unknown>, tenantId?: string): void;
export declare function appendThreatDiscoveryLog(kind: ThreatDiscoveryJobKind, message: string, tenantId?: string): void;
export declare function finishThreatDiscoveryJob(kind: ThreatDiscoveryJobKind, outcome: {
    ok: boolean;
    error?: string;
    extra?: Record<string, unknown>;
}, tenantId?: string): void;
export declare function readThreatDiscoveryLogTail(kind: ThreatDiscoveryJobKind, tenantId?: string, maxLines?: number): string;
//# sourceMappingURL=threat-discovery-job-file.d.ts.map