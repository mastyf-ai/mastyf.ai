export interface RugPullEvent {
    id: string;
    serverName: string;
    tenantId: string;
    previousFingerprint: string;
    currentFingerprint: string;
    toolCount: number;
    detectedAt: string;
    status: 'pending' | 'reviewed' | 'dismissed' | 'mitigated';
    reviewedAt?: string;
    reviewedBy?: string;
}
export declare function persistRugPullEvent(event: Omit<RugPullEvent, 'id' | 'detectedAt' | 'status' | 'reviewedAt' | 'reviewedBy'>): RugPullEvent;
export declare function listRugPullEvents(opts?: {
    tenantId?: string;
    serverName?: string;
    windowHours?: number;
    status?: string;
    limit?: number;
}): RugPullEvent[];
export declare function countRugPullEvents(opts?: {
    tenantId?: string;
    windowHours?: number;
    status?: string;
}): number;
export declare function updateRugPullEvent(id: string, updates: {
    status?: RugPullEvent['status'];
    reviewedBy?: string;
}): boolean;
export declare function clearRugPullEvents(serverName?: string): void;
export declare function getRugPullStatus(): {
    unreviewed: number;
    total: number;
    activeBlockedServers: string[];
    lastDetected: string | null;
    serverStatuses: Record<string, {
        pending: number;
        reviewed: number;
        lastEvent: string;
    }>;
};
//# sourceMappingURL=rug-pull-store.d.ts.map