/**
 * Perimeter honesty helpers — never claim empty history as “no blocks”
 * when the live gateway ledger has stops.
 * Keep in sync with deploy/dashboard-spa/.../perimeterHonesty.ts
 */
export function normalizeDataSource(raw) {
    const s = String(raw || '')
        .trim()
        .toLowerCase();
    if (s === 'live' || s === 'live-gateway' || s === 'gateway')
        return 'live-gateway';
    if (s === 'history' || s === 'history-db' || s === 'db')
        return 'history-db';
    if (s === 'simulated' || s === 'harness' || s === 'fixture')
        return 'simulated';
    return 'unavailable';
}
export function kpiEmptyMessage(source) {
    switch (source) {
        case 'live-gateway':
            return 'No live events in window';
        case 'history-db':
            return 'History unavailable — not “zero risk”';
        case 'simulated':
            return 'Simulated / harness only';
        default:
            return 'UNAVAILABLE';
    }
}
export function isContradictingEmptyAggregate(params) {
    return params.ledgerBlocked > 0 && params.historyTotalRequests === 0;
}
export function blockedKpiSecondary(params) {
    if (params.historyBlocked > 0) {
        return `${params.historyBlocked.toLocaleString()} blocked (history.db)`;
    }
    if (isContradictingEmptyAggregate({
        ledgerBlocked: params.ledgerBlocked,
        historyTotalRequests: params.historyTotalRequests,
    })) {
        // Live count is already the primary KPI — don't restate source mechanics under it.
        return '';
    }
    if (params.historyTotalRequests === 0) {
        return 'History unavailable — not “no blocks”';
    }
    return 'No blocks in history window';
}
export function labelMetricSource(source) {
    switch (source) {
        case 'live-gateway':
            return 'LIVE';
        case 'history-db':
            return 'HISTORY';
        case 'simulated':
            return 'SIMULATED';
        default:
            return 'UNAVAILABLE';
    }
}
export function preferLivePrimary(params) {
    return params.liveOnline && params.historyEmpty && params.liveSignal > 0;
}
/** Probe / harness receipt ids must not be sold as customer traffic. */
export function isHarnessReceiptId(id) {
    if (!id)
        return false;
    return /^(slo-e2e|node-e2e-lat|obs-prom|pw_shield|allow_once_next_)/i.test(id);
}
//# sourceMappingURL=perimeter-honesty.js.map