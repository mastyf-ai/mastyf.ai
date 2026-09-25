import type { ObservatorySnapshot } from './ecosystem-observatory.js';
export interface CloudObservatoryPayload {
    adoptionScore?: number;
    threatHeatIndex?: number;
    avgBlockRate?: number;
    serverCount?: number;
    topThreatClasses?: Array<{
        cls: string;
        count: number;
    }>;
    generatedAt?: string;
    metrics?: Array<{
        metricType: string;
        value: number;
        dimension?: Record<string, unknown>;
    }>;
}
export declare function pullCloudObservatorySnapshot(): Promise<CloudObservatoryPayload | null>;
/** Merge cloud snapshot fields into local observatory metrics (B2 network effects). */
export declare function cloudPayloadToLocalMetrics(payload: CloudObservatoryPayload): Array<{
    metricType: string;
    value: number;
    dimension?: Record<string, unknown>;
}>;
export declare function mergeCloudIntoSnapshot(local: ObservatorySnapshot, cloud: CloudObservatoryPayload): ObservatorySnapshot;
//# sourceMappingURL=observatory-cloud-relay.d.ts.map