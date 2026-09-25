import { Registry, Counter, Gauge, Histogram } from 'prom-client';
export declare const registry: Registry<"text/plain; version=0.0.4; charset=utf-8">;
/** Attach tenant_id label for multi-tenant Prometheus dashboards. */
export declare function withTenantMetricLabels(labels: Record<string, string>, tenantId?: string): Record<string, string>;
export declare const requestsTotal: Counter<"tenant_id" | "server_name" | "decision" | "authn_success">;
export declare const blockedRequestsTotal: Counter<"tenant_id" | "server_name" | "rule" | "block_reason">;
export declare const rugpullDetectedTotal: Counter<"tenant_id" | "server_name">;
export declare const proxyInflightRejectedTotal: Counter<"tenant_id" | "server_name">;
export declare const semanticSyncRequestBlocksTotal: Counter<"tenant_id" | "server_name">;
export declare const semanticAsyncTimeoutTotal: Counter<"label">;
export declare const policyCacheHitsTotal: Counter<"allowed" | "tenant_id">;
export declare const sessionFlowBackend: Gauge<string>;
export declare const attacksBlockedTotal: Counter<"tenant_id" | "category" | "rule">;
export declare const costSpentUsdTotal: Counter<"tenant_id">;
/** Record attack block with category label for enterprise dashboards. */
export declare function recordAttackBlocked(rule: string, tenantId?: string, category?: string): void;
/** Increment blocked request counter and attack-by-category metric together. */
export declare function recordProxyBlock(labels: {
    server_name: string;
    block_reason: string;
    rule: string;
    tenant_id?: string;
}, category?: string): void;
export declare function recordCostSpendUsd(amount: number, tenantId?: string): void;
export declare const injectionDetectedTotal: Counter<"severity" | "server_name">;
export declare const authFailuresTotal: Counter<"reason" | "server_name">;
export declare const circuitBreakerState: Gauge<"server_name">;
export declare const circuitBreakerSyncTotal: Counter<"result" | "op">;
export declare const activeSessions: Gauge<string>;
export declare const activeProxies: Gauge<string>;
export declare const sseUntrackedServers: Gauge<"server_name">;
export declare const proxyLatencyMs: Histogram<"tenant_id" | "server_name">;
/** Authoritative /v1/decide latency (ms). Scraped on METRICS_PORT. */
export declare const decideLatencyMs: Histogram<string>;
export declare const authLatencyMs: Histogram<"server_name">;
export declare const requestDurationSeconds: Histogram<"server_name" | "decision">;
export declare const tokenCostUsd: Histogram<"model" | "server_name">;
export declare const instantLearningEventsTotal: Counter<"outcome" | "block_rule">;
export declare const suggestionQueueDepth: Gauge<"tenant_id">;
export declare const redisAvailable: Gauge<string>;
export declare const semanticLlmOnline: Gauge<string>;
export declare const loopBlocksTotal: Counter<"tenant_id" | "rule">;
export declare const auditQueueDepth: Gauge<string>;
export declare const alertingConfigured: Gauge<string>;
export declare const tracingConfigured: Gauge<string>;
export declare const ledgerChainValid: Gauge<string>;
export declare const escalateBacklog: Gauge<string>;
export declare const selfTestAgeSeconds: Gauge<string>;
export declare function observePerimeterSloGauges(input: {
    chainOk?: boolean | null;
    escalated?: number | null;
    selfTestUnixSec?: number | null;
    nowUnixSec?: number;
}): void;
export declare const semanticScanDurationSeconds: Histogram<"outcome" | "phase">;
export declare const tenantSpendUsdDayRatio: Gauge<string>;
export declare const tenantTokensPerMin: Gauge<"tenant_id">;
export declare function recordSemanticScanDuration(phase: string, durationMs: number, outcome: string): void;
/** Update suggestion queue depth from pending suggestions file or engine state. */
export declare function setSuggestionQueueDepth(count: number, tenantId?: string): void;
/** Release Prometheus HTTP server, maintenance timers, and registry listeners. */
export declare function shutdownMetrics(): Promise<void>;
/** Alias for shutdownMetrics (IDE lifecycle hooks). */
export declare const dispose: typeof shutdownMetrics;
export declare function startMetricsServer(port?: number): Promise<Registry>;
/** @internal Test hook — whether maintenance interval is active */
export declare function isMetricsMaintenanceActive(): boolean;
//# sourceMappingURL=metrics.d.ts.map