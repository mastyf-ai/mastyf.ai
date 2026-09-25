/**
 * B2 — MCP Ecosystem Health Observatory (aggregated anonymized telemetry).
 */
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import { type CloudObservatoryPayload } from './observatory-cloud-relay.js';
export interface ObservatoryMetric {
    metricType: string;
    value: number;
    dimension?: Record<string, unknown>;
    recordedAt: string;
}
export interface ObservatorySnapshot {
    adoptionScore: number;
    threatHeatIndex: number;
    avgBlockRate: number;
    serverCount: number;
    topThreatClasses: Array<{
        cls: string;
        count: number;
    }>;
    generatedAt: string;
    trends?: {
        blockRateDelta: number;
        serverCountDelta: number;
        threatHeatDelta: number;
    };
}
export interface ObservatoryAlert {
    alertType: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    metricType?: string;
    threshold?: number;
    observedValue?: number;
    createdAt: string;
}
export declare class EcosystemObservatory {
    private readonly store?;
    private memoryMetrics;
    private lastSnapshot;
    constructor(store?: IndustryStandardStore | undefined);
    recordMetric(metricType: string, value: number, dimension?: Record<string, unknown>): void;
    ingestBenchmarkSubmission(params: {
        blockRate: number;
        falsePositiveRate: number;
        serverCount: number;
        threatClasses?: Record<string, number>;
    }): void;
    snapshot(): ObservatorySnapshot;
    /** Proactive threshold alerts (B2). */
    evaluateProactiveAlerts(): ObservatoryAlert[];
    listAlerts(limit?: number): ObservatoryAlert[];
    /** Ingest metrics from Mastyf AI Cloud observatory relay (B2). */
    ingestCloudMetrics(metrics: Array<{
        metricType: string;
        value: number;
        dimension?: Record<string, unknown>;
    }>): number;
    /** Snapshot merged with optional cloud overlay. */
    snapshotWithCloud(cloud?: CloudObservatoryPayload): ObservatorySnapshot;
}
//# sourceMappingURL=ecosystem-observatory.d.ts.map