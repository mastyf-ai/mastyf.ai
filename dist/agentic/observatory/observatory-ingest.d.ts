/**
 * B2 — Wire mastyf-ai-cloud relay into ecosystem observatory.
 */
import type { EcosystemObservatory } from './ecosystem-observatory.js';
export declare function ingestMastyfAiBenchIntoObservatory(observatory: EcosystemObservatory, submission: {
    blockRate: number;
    falsePositiveRate: number;
    serverCount: number;
    threatClasses?: Record<string, number>;
    mastyfAiVersion?: string;
}): void;
export declare function ingestFleetHeartbeatIntoObservatory(observatory: EcosystemObservatory, heartbeat: {
    instanceCount?: number;
    serverCount?: number;
    blockRate?: number;
}): void;
export declare function ingestMtxCatalogIntoObservatory(observatory: EcosystemObservatory, signatures: Array<{
    category: string;
    severity?: string;
}>): void;
/** Pull and ingest live ecosystem telemetry from Mastyf AI Cloud (B2). */
export declare function ingestCloudObservatoryRelay(observatory: EcosystemObservatory): Promise<{
    ingested: number;
    cloudAvailable: boolean;
}>;
//# sourceMappingURL=observatory-ingest.d.ts.map