import { StructuredLogger } from './structured-logger.js';
const SLOW_QUERY_MS = parseInt(process.env['MASTYF_AI_DB_SLOW_QUERY_MS'] || '100', 10);
export function getSlowQueryThresholdMs() {
    return Number.isFinite(SLOW_QUERY_MS) && SLOW_QUERY_MS > 0 ? SLOW_QUERY_MS : 100;
}
/** Wrap a DB operation and log when duration exceeds threshold. */
export function monitorDbQuery(label, fn) {
    const start = Date.now();
    try {
        return fn();
    }
    finally {
        const durationMs = Date.now() - start;
        if (durationMs > getSlowQueryThresholdMs()) {
            StructuredLogger.info({
                event: 'db_slow_query',
                label,
                durationMs,
                thresholdMs: getSlowQueryThresholdMs(),
            });
        }
    }
}
/** Async variant for promise-returning DB helpers. */
export async function monitorDbQueryAsync(label, fn) {
    const start = Date.now();
    try {
        return await fn();
    }
    finally {
        const durationMs = Date.now() - start;
        if (durationMs > getSlowQueryThresholdMs()) {
            StructuredLogger.info({
                event: 'db_slow_query',
                label,
                durationMs,
                thresholdMs: getSlowQueryThresholdMs(),
            });
        }
    }
}
//# sourceMappingURL=db-performance-monitor.js.map