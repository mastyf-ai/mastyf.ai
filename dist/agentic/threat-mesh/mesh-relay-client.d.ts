import type { ThreatSignature } from './mesh-node.js';
export interface MeshRelayConfig {
    relayUrl: string;
    apiKey?: string;
    tenantId?: string;
    timeoutMs?: number;
}
export interface MtxRelayRecord {
    signatureHash: string;
    mtxJson: string;
    category: string;
    severity: string;
    verified: boolean;
    reportCount?: number;
}
export declare class MeshRelayClient {
    private readonly config;
    private connected;
    private lastSyncAt;
    constructor(config: MeshRelayConfig);
    isConnected(): boolean;
    getLastSyncAt(): string | null;
    private headers;
    publish(records: MtxRelayRecord[]): Promise<{
        ok: boolean;
        published: number;
        error?: string;
    }>;
    pullCatalog(limit?: number): Promise<{
        ok: boolean;
        signatures: ThreatSignature[];
        error?: string;
    }>;
}
//# sourceMappingURL=mesh-relay-client.d.ts.map