import { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface ThreatSignature {
    signatureHash: string;
    category: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    firstSeen: string;
    reportCount: number;
    verified: boolean;
    metadata?: Record<string, unknown>;
}
export interface MeshConfig {
    enabled: boolean;
    relayUrl?: string;
    relayApiKey?: string;
    minReportThreshold: number;
    privacyEpsilon: number;
    maxLocalSignatures: number;
}
export interface MeshSyncResult {
    published: number;
    pulled: number;
    relayConnected: boolean;
    error?: string;
}
export declare class ThreatMeshNode {
    private readonly store?;
    private config;
    private localSignatures;
    private pendingSignatures;
    private relay;
    private pendingRelayPublish;
    constructor(store?: IndustryStandardStore | undefined);
    private loadConfig;
    private hydrateFromStore;
    isEnabled(): boolean;
    submitObservation(rawPattern: string, category: string, severity: ThreatSignature['severity'], toolName?: string): ThreatSignature | null;
    syncWithRelay(): Promise<MeshSyncResult>;
    lookupPattern(rawPattern: string): ThreatSignature | null;
    getAllSignatures(): ThreatSignature[];
    getSignaturesByCategory(category: string): ThreatSignature[];
    getStats(): {
        enabled: boolean;
        localSignatures: number;
        pendingSignatures: number;
        relayConnected: boolean;
        lastRelaySync?: string | null;
    };
    isKnownThreat(signatureHash: string): boolean;
    private hashPattern;
    private persistMtx;
    private queueRelayPublish;
    private applyPrivacyNoise;
}
//# sourceMappingURL=mesh-node.d.ts.map