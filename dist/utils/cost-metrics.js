/** Hours spanned by call record timestamps (minimum 1 minute). */
export function recordsTimeSpanHours(records) {
    const times = records
        .map((r) => new Date(r.timestamp || 0).getTime())
        .filter((t) => Number.isFinite(t) && t > 0);
    if (times.length < 2)
        return 1 / 60;
    const spanMs = Math.max(...times) - Math.min(...times);
    return Math.max(spanMs / 3_600_000, 1 / 60);
}
export function computeBurnRatePerHour(costUsd, records) {
    const hours = recordsTimeSpanHours(records);
    return hours > 0 ? costUsd / hours : 0;
}
export function computeProjectedMonthly(costUsd, records) {
    const hours = recordsTimeSpanHours(records);
    if (hours <= 0 || records.length < 2)
        return 0;
    return (costUsd / hours) * 24 * 30;
}
//# sourceMappingURL=cost-metrics.js.map