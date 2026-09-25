/**
 * Drift Detector — monitors MCP server behavior for anomalies indicating
 * compromise, silent updates, or degradation.
 *
 * Compares current behavior (tool schemas, response shapes, latency profiles,
 * error patterns) against a known-good baseline snapshot.
 */
import type { AgenticResult } from '../core.js';
export interface BehaviorBaseline {
    /** Baseline id */
    id: string;
    /** Server this baseline is for */
    serverName: string;
    /** When the baseline was captured */
    capturedAt: string;
    /** Tool definitions at capture time */
    toolSchemas: Record<string, ToolSchema>;
    /** Typical response shapes */
    responseShapes: Record<string, ResponseShape>;
    /** Performance baseline */
    performance: PerformanceBaseline;
    /** Policy configuration at capture time (for rollback) */
    configSnapshot?: string;
}
export interface ToolSchema {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    /** Hash of the schema for quick comparison */
    schemaHash: string;
}
export interface ResponseShape {
    /** JSON schema of typical successful response */
    successSchema?: Record<string, unknown>;
    /** JSON schema of typical error response */
    errorSchema?: Record<string, unknown>;
    /** Hash for quick comparison */
    shapeHash: string;
}
export interface PerformanceBaseline {
    /** p50 latency in ms */
    latencyP50: number;
    /** p95 latency in ms */
    latencyP95: number;
    /** Successful call rate (0-1) */
    successRate: number;
    /** Average response size in bytes */
    avgResponseSize: number;
}
export interface DriftDetectionResult {
    /** Whether drift was detected */
    drifted: boolean;
    /** Server name */
    serverName: string;
    /** Baseline compared against */
    baselineId: string;
    /** Total drift score 0-100 (higher = more drift) */
    driftScore: number;
    /** Individual drift findings */
    findings: DriftFinding[];
    /** Whether automatic rollback is recommended */
    recommendRollback: boolean;
    /** Human-readable summary */
    summary: string;
}
export interface DriftFinding {
    type: 'schema_change' | 'performance_degradation' | 'error_increase' | 'response_change' | 'new_tool' | 'removed_tool';
    severity: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    metric: string;
    baseline: number | string;
    current: number | string;
    changePercent: number;
}
export declare class DriftDetector {
    private baselines;
    /**
     * Capture a behavioral baseline for a server.
     */
    captureBaseline(serverName: string, tools: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
    }[], performance: PerformanceBaseline, configSnapshot?: string): BehaviorBaseline;
    /**
     * Detect drift between current server behavior and a baseline.
     */
    detectDrift(baseline: BehaviorBaseline, currentTools: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
    }[], currentPerformance: PerformanceBaseline): AgenticResult<DriftDetectionResult>;
    /**
     * Detect performance drift.
     */
    private detectPerformanceDrift;
    /**
     * Compute an overall drift score from individual findings.
     */
    private computeDriftScore;
    /**
     * Get the most recent baseline for a server.
     */
    getLatestBaseline(serverName: string): BehaviorBaseline | undefined;
    /**
     * Get all baselines for a server.
     */
    getBaselines(serverName: string): BehaviorBaseline[];
    /**
     * Get a specific baseline by id.
     */
    getBaseline(serverName: string, baselineId: string): BehaviorBaseline | undefined;
    /** Simple string hashing for schema comparison. */
    private hashString;
}
//# sourceMappingURL=drift-detector.d.ts.map