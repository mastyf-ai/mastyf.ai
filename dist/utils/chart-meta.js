/**
 * Standard metadata envelope for dashboard chart APIs.
 */
import { parseWindowDays, windowToLabel } from './time-buckets.js';
export function buildChartMeta(opts) {
    const windowDays = parseWindowDays(opts.windowDays);
    return {
        window: windowToLabel(windowDays),
        windowDays,
        generatedAt: opts.generatedAt ?? new Date().toISOString(),
        recordCount: opts.recordCount,
        sparse: opts.sparse,
        dataSources: opts.dataSources,
        emptyReason: opts.emptyReason,
    };
}
//# sourceMappingURL=chart-meta.js.map