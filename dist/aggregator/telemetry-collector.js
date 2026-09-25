/**
 * Telemetry Collector — scrapes Prometheus /metrics from all registered
 * MCP Mastyf AI instances and aggregates them into the central PostgreSQL
 * aggregated_metrics table for real-time dashboards and historical analysis.
 */
import { loadPg } from '../database/pg-loader.js';
import { Logger } from '../utils/logger.js';
const DEFAULT_CONFIG = {
    scrapeIntervalMs: parseInt(process.env['MASTYF_AI_TELEMETRY_INTERVAL_MS'] || '15000', 10),
    databaseUrl: process.env['DATABASE_URL'] || 'postgresql://localhost:5432/mastyf_ai',
    endpoints: parseEndpoints(process.env['MASTYF_AI_TELEMETRY_ENDPOINTS'] || ''),
};
function parseEndpoints(env) {
    if (!env)
        return [];
    try {
        const parsed = JSON.parse(env);
        if (Array.isArray(parsed))
            return parsed;
    }
    catch {
        // Comma-separated list of URLs: "http://instance1:9090,http://instance2:9090"
        return env.split(',').map((url, i) => ({
            instanceId: `instance-${i + 1}`,
            metricsUrl: url.trim(),
        }));
    }
    return [];
}
export class TelemetryCollector {
    pgPool;
    poolReady = null;
    config;
    scrapeTimer = null;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    async ensurePool() {
        if (!this.poolReady) {
            this.poolReady = (async () => {
                const { Pool } = await loadPg();
                this.pgPool = new Pool({
                    connectionString: this.config.databaseUrl,
                    max: 5,
                    idleTimeoutMillis: 30000,
                });
            })();
        }
        await this.poolReady;
        return this.pgPool;
    }
    /**
     * Register an instance endpoint for scraping.
     * Also registers the instance in mastyf_ai_instances if not already there.
     */
    async registerInstance(instance) {
        const exists = this.config.endpoints.find(e => e.instanceId === instance.instanceId);
        if (!exists) {
            this.config.endpoints.push(instance);
        }
        // Ensure instance exists in PG
        const pool = await this.ensurePool();
        const client = await pool.connect();
        try {
            await client.query(`INSERT INTO mastyf_ai_instances (instance_id, instance_name, status)
         VALUES ($1, $2, 'active')
         ON CONFLICT (instance_id) DO UPDATE
         SET last_heartbeat = NOW(), status = 'active'`, [instance.instanceId, instance.instanceId]);
        }
        finally {
            client.release();
        }
    }
    /** Start periodic scraping */
    async start() {
        if (this.scrapeTimer)
            return;
        if (this.config.endpoints.length > 0) {
            await this.ensurePool();
        }
        Logger.info(`[TelemetryCollector] Starting periodic scrape every ${this.config.scrapeIntervalMs}ms for ${this.config.endpoints.length} instances`);
        this.scrapeTimer = setInterval(() => {
            this.scrapeAll().catch(err => {
                Logger.error(`[TelemetryCollector] Scrape failed: ${err instanceof Error ? err.message : String(err)}`);
            });
        }, this.config.scrapeIntervalMs);
        // Initial scrape
        this.scrapeAll().catch(err => {
            Logger.error(`[TelemetryCollector] Initial scrape failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
    /** Stop periodic scraping */
    stop() {
        if (this.scrapeTimer) {
            clearInterval(this.scrapeTimer);
            this.scrapeTimer = null;
        }
    }
    /** Scrape all registered instances */
    async scrapeAll() {
        if (this.config.endpoints.length === 0)
            return;
        const results = await Promise.allSettled(this.config.endpoints.map(endpoint => this.scrapeInstance(endpoint)));
        for (const result of results) {
            if (result.status === 'rejected') {
                Logger.warn(`[TelemetryCollector] Scrape failed: ${result.reason?.message}`);
            }
        }
    }
    /** Scrape a single instance's Prometheus endpoint */
    async scrapeInstance(endpoint) {
        let metricsText;
        try {
            const baseUrl = endpoint.metricsUrl.replace(/\/+$/, ''); // strip trailing slashes
            const scrapeUrl = baseUrl.endsWith('/metrics') ? baseUrl : `${baseUrl}/metrics`;
            const response = await fetch(scrapeUrl, {
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            metricsText = await response.text();
        }
        catch (err) {
            Logger.warn(`[TelemetryCollector] Failed to scrape ${endpoint.instanceId} at ${endpoint.metricsUrl}: ${err instanceof Error ? err.message : String(err)}`);
            // Mark instance as degraded
            await this.markInstanceDegraded(endpoint.instanceId);
            return;
        }
        const parsed = this.parsePrometheusMetrics(endpoint.instanceId, metricsText);
        await this.storeMetrics(parsed);
        // Update heartbeat timestamp
        endpoint.lastScrapeTimestamp = parsed.timestamp;
        Logger.debug(`[TelemetryCollector] Scraped ${endpoint.instanceId}: ${parsed.totalRequests} reqs, ${parsed.blockedRequests} blocked, $${parsed.totalCostUsd.toFixed(6)}`);
    }
    /** Parse Prometheus text exposition format into ParsedMetrics */
    parsePrometheusMetrics(instanceId, text) {
        const metrics = {
            instanceId,
            timestamp: new Date().toISOString(),
            totalRequests: 0,
            blockedRequests: 0,
            passedRequests: 0,
            flaggedRequests: 0,
            injectionDetections: 0,
            authFailures: 0,
            activeProxyCount: 0,
            activeSessionCount: 0,
            avgLatencyMs: 0,
            p50LatencyMs: 0,
            p95LatencyMs: 0,
            p99LatencyMs: 0,
            circuitBreakerOpen: 0,
            totalCostUsd: 0,
            tokenUsageTotal: 0,
        };
        const lines = text.split('\n');
        for (const line of lines) {
            // Skip comments and blank lines
            if (line.startsWith('#') || !line.trim())
                continue;
            // Prometheus format: metric_name{labels} value [optional timestamp]
            // Split on whitespace and extract metric + value (ignore optional timestamp)
            const parts = line.trim().split(/\s+/);
            if (parts.length < 2)
                continue;
            // Try last token as value; if NaN, try second-to-last (timestamp present)
            let value = parseFloat(parts[parts.length - 1]);
            let valueTokenIdx = parts.length - 1;
            if (isNaN(value) && parts.length >= 3) {
                value = parseFloat(parts[parts.length - 2]);
                valueTokenIdx = parts.length - 2;
            }
            if (isNaN(value))
                continue;
            const metricPart = parts.slice(0, valueTokenIdx).join(' ');
            const bracketIdx = metricPart.indexOf('{');
            const metricName = bracketIdx >= 0 ? metricPart.slice(0, bracketIdx) : metricPart;
            // Map known metric names
            switch (metricName) {
                case 'mastyf_ai_requests_total':
                    metrics.totalRequests += value;
                    break;
                case 'mastyf_ai_blocked_total':
                    metrics.blockedRequests += value;
                    break;
                case 'mastyf_ai_injection_detected_total':
                    metrics.injectionDetections += value;
                    break;
                case 'mastyf_ai_auth_failures_total':
                    metrics.authFailures += value;
                    break;
                case 'mastyf_ai_active_proxies':
                    metrics.activeProxyCount = Math.max(metrics.activeProxyCount, value);
                    break;
                case 'mastyf_ai_active_sessions':
                    metrics.activeSessionCount = Math.max(metrics.activeSessionCount, value);
                    break;
                case 'mastyf_ai_circuit_breaker_state':
                    if (value === 1)
                        metrics.circuitBreakerOpen++;
                    break;
                case 'mastyf_ai_token_cost_usd_sum':
                    metrics.totalCostUsd += value;
                    break;
                // Histogram quantiles for latency
                case 'mastyf_ai_proxy_latency_ms':
                    if (metricPart.includes('quantile="0.5"'))
                        metrics.p50LatencyMs = value;
                    else if (metricPart.includes('quantile="0.95"'))
                        metrics.p95LatencyMs = value;
                    else if (metricPart.includes('quantile="0.99"'))
                        metrics.p99LatencyMs = value;
                    break;
                // Request duration
                case 'mastyf_ai_request_duration_seconds_count':
                    metrics._requestCount = (metrics._requestCount || 0) + value;
                    break;
                case 'mastyf_ai_request_duration_seconds_sum':
                    metrics._requestDurationSumMs = (metrics._requestDurationSumMs || 0) + value * 1000;
                    break;
                case 'mastyf_ai_token_usage_total':
                    metrics.tokenUsageTotal += value;
                    break;
            }
        }
        // Compute average latency from sum / count
        if (metrics._requestCount > 0) {
            metrics.avgLatencyMs = metrics._requestDurationSumMs / metrics._requestCount;
        }
        // Derive passed/flagged: passed = total - blocked - flagged (flagged not directly tracked in counters)
        // For now, assume flagged are included in injection_detections count
        metrics.flaggedRequests = metrics.injectionDetections;
        metrics.passedRequests = Math.max(0, metrics.totalRequests - metrics.blockedRequests - metrics.flaggedRequests);
        return metrics;
    }
    /** Store parsed metrics in PostgreSQL */
    async storeMetrics(metrics) {
        const pool = await this.ensurePool();
        const client = await pool.connect();
        try {
            await client.query(`INSERT INTO aggregated_metrics
         (instance_id, timestamp, total_requests, blocked_requests, passed_requests,
          flagged_requests, injection_detections, auth_failures,
          active_proxy_count, active_session_count, avg_latency_ms,
          p50_latency_ms, p95_latency_ms, p99_latency_ms,
          circuit_breaker_open, total_cost_usd, token_usage_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`, [
                metrics.instanceId,
                metrics.timestamp,
                metrics.totalRequests,
                metrics.blockedRequests,
                metrics.passedRequests,
                metrics.flaggedRequests,
                metrics.injectionDetections,
                metrics.authFailures,
                metrics.activeProxyCount,
                metrics.activeSessionCount,
                metrics.avgLatencyMs,
                metrics.p50LatencyMs,
                metrics.p95LatencyMs,
                metrics.p99LatencyMs,
                metrics.circuitBreakerOpen,
                metrics.totalCostUsd,
                metrics.tokenUsageTotal,
            ]);
        }
        finally {
            client.release();
        }
    }
    /** Mark an instance as degraded when scraping fails */
    async markInstanceDegraded(instanceId) {
        try {
            const pool = await this.ensurePool();
            const client = await pool.connect();
            try {
                await client.query(`UPDATE mastyf_ai_instances
           SET status = CASE
             WHEN last_heartbeat < NOW() - INTERVAL '5 minutes' THEN 'offline'
             ELSE 'degraded'
           END
           WHERE instance_id = $1`, [instanceId]);
            }
            finally {
                client.release();
            }
        }
        catch {
            // Silently fail — don't cascade errors
        }
    }
    /** Query historical metrics from PG for dashboards */
    async getMetricsHistory(options = {}) {
        try {
            const { instanceId, fromTimestamp, toTimestamp, limit = 100 } = options;
            const pool = await this.ensurePool();
            const client = await pool.connect();
            try {
                let query = 'SELECT * FROM aggregated_metrics WHERE 1=1';
                const params = [];
                let paramIdx = 1;
                if (instanceId) {
                    query += ` AND instance_id = $${paramIdx++}`;
                    params.push(instanceId);
                }
                if (fromTimestamp) {
                    query += ` AND timestamp >= $${paramIdx++}`;
                    params.push(fromTimestamp);
                }
                if (toTimestamp) {
                    query += ` AND timestamp <= $${paramIdx++}`;
                    params.push(toTimestamp);
                }
                query += ` ORDER BY timestamp DESC LIMIT $${paramIdx++}`;
                params.push(limit);
                const result = await client.query(query, params);
                return result.rows;
            }
            finally {
                client.release();
            }
        }
        catch (err) {
            Logger.warn(`[TelemetryCollector] Query metrics failed: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    /** Get list of active instances with their latest metrics */
    async getActiveInstances() {
        try {
            const pool = await this.ensurePool();
            const client = await pool.connect();
            try {
                const result = await client.query(`SELECT gi.*, am.total_requests, am.blocked_requests, am.total_cost_usd, am.avg_latency_ms
           FROM mastyf_ai_instances gi
           LEFT JOIN LATERAL (
             SELECT * FROM aggregated_metrics
             WHERE instance_id = gi.instance_id
             ORDER BY timestamp DESC LIMIT 1
           ) am ON true
           WHERE gi.last_heartbeat > NOW() - INTERVAL '5 minutes'
           ORDER BY gi.last_heartbeat DESC`);
                return result.rows;
            }
            finally {
                client.release();
            }
        }
        catch (err) {
            Logger.warn(`[TelemetryCollector] Get instances failed: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    async close() {
        this.stop();
        if (this.poolReady) {
            const pool = await this.ensurePool();
            await pool.end();
        }
    }
}
//# sourceMappingURL=telemetry-collector.js.map