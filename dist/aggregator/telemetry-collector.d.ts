export interface InstanceEndpoint {
    instanceId: string;
    metricsUrl: string;
    lastScrapeTimestamp?: string;
}
export interface ParsedMetrics {
    instanceId: string;
    timestamp: string;
    totalRequests: number;
    blockedRequests: number;
    passedRequests: number;
    flaggedRequests: number;
    injectionDetections: number;
    authFailures: number;
    activeProxyCount: number;
    activeSessionCount: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    circuitBreakerOpen: number;
    totalCostUsd: number;
    tokenUsageTotal: number;
}
export interface TelemetryConfig {
    scrapeIntervalMs: number;
    databaseUrl: string;
    endpoints: InstanceEndpoint[];
}
export declare class TelemetryCollector {
    private pgPool;
    private poolReady;
    private config;
    private scrapeTimer;
    constructor(config?: Partial<TelemetryConfig>);
    private ensurePool;
    /**
     * Register an instance endpoint for scraping.
     * Also registers the instance in mastyf_ai_instances if not already there.
     */
    registerInstance(instance: InstanceEndpoint): Promise<void>;
    /** Start periodic scraping */
    start(): Promise<void>;
    /** Stop periodic scraping */
    stop(): void;
    /** Scrape all registered instances */
    scrapeAll(): Promise<void>;
    /** Scrape a single instance's Prometheus endpoint */
    private scrapeInstance;
    /** Parse Prometheus text exposition format into ParsedMetrics */
    private parsePrometheusMetrics;
    /** Store parsed metrics in PostgreSQL */
    private storeMetrics;
    /** Mark an instance as degraded when scraping fails */
    private markInstanceDegraded;
    /** Query historical metrics from PG for dashboards */
    getMetricsHistory(options?: {
        instanceId?: string;
        fromTimestamp?: string;
        toTimestamp?: string;
        limit?: number;
    }): Promise<any[]>;
    /** Get list of active instances with their latest metrics */
    getActiveInstances(): Promise<any[]>;
    close(): Promise<void>;
}
//# sourceMappingURL=telemetry-collector.d.ts.map