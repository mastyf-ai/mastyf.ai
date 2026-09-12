/**
 * Perimeter honesty helpers — never claim empty history as “no blocks”
 * when the live gateway ledger has stops.
 * Keep in sync with src/dashboard/perimeter-honesty.ts
 */

export type DataSource = 'live-gateway' | 'history-db' | 'unavailable' | 'simulated';

/** Roadmap A0 aliases → canonical DataSource */
export function normalizeDataSource(
  raw: string | null | undefined,
): DataSource {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'live' || s === 'live-gateway' || s === 'gateway') return 'live-gateway';
  if (s === 'history' || s === 'history-db' || s === 'db') return 'history-db';
  if (s === 'simulated' || s === 'harness' || s === 'fixture') return 'simulated';
  return 'unavailable';
}

export function kpiEmptyMessage(source: DataSource): string {
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

export function isContradictingEmptyAggregate(params: {
  ledgerBlocked: number;
  historyTotalRequests: number;
}): boolean {
  return params.ledgerBlocked > 0 && params.historyTotalRequests === 0;
}

export function blockedKpiSecondary(params: {
  historyBlocked: number;
  ledgerBlocked: number;
  historyTotalRequests: number;
}): string {
  if (params.historyBlocked > 0) {
    return `${params.historyBlocked.toLocaleString()} blocked (history.db)`;
  }
  if (
    isContradictingEmptyAggregate({
      ledgerBlocked: params.ledgerBlocked,
      historyTotalRequests: params.historyTotalRequests,
    })
  ) {
    // Live count is already the primary KPI — don't restate source mechanics under it.
    return '';
  }
  if (params.historyTotalRequests === 0) {
    return 'History unavailable — not “no blocks”';
  }
  return 'No blocks in history window';
}

export function labelMetricSource(source: DataSource): string {
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

/** Prefer live ledger counts when history.db is empty but gateway has receipts. */
/** Probe / harness receipt ids must not be sold as customer traffic. */
export function isHarnessReceiptId(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^(slo-e2e|node-e2e-lat|obs-prom|pw_shield|allow_once_next_)/i.test(id);
}

export function preferLivePrimary(params: {
  liveOnline: boolean;
  historyEmpty: boolean;
  liveSignal: number;
}): boolean {
  return params.liveOnline && params.historyEmpty && params.liveSignal > 0;
}
