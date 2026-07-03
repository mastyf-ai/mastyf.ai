import type { PerformanceBaseline } from '../agentic/drift/drift-detector.js';
import type { ProxyCallRecord } from '../types.js';

const APPROX_BYTES_PER_TOKEN = 4;

export type ObservedTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export function parseMastyfTimestamp(ts: string): number {
  if (!ts) return NaN;
  if (/[TZ]/.test(ts)) return Date.parse(ts);
  return Date.parse(`${ts.replace(' ', 'T')}Z`);
}

export function filterRecordsByWindow(
  records: ProxyCallRecord[],
  windowDays: number,
  nowMs = Date.now(),
): ProxyCallRecord[] {
  const cutoff = nowMs - windowDays * 24 * 60 * 60 * 1000;
  return records.filter((record) => {
    const ts = parseMastyfTimestamp(record.timestamp);
    return !Number.isNaN(ts) && ts >= cutoff;
  });
}

export function percentile(values: number[], pct: number): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * pct)));
  return sorted[idx] ?? 0;
}

export function computeMeasuredPerformance(records: ProxyCallRecord[]): PerformanceBaseline | null {
  if (records.length === 0) return null;
  const latencies = records.map((r) => Number(r.durationMs)).filter((v) => Number.isFinite(v) && v >= 0);
  if (latencies.length === 0) return null;
  const successes = records.filter((r) => !r.blocked).length;
  const avgResponseSize = records.reduce((sum, r) => sum + Math.max(0, Number(r.responseTokens) || 0) * APPROX_BYTES_PER_TOKEN, 0) / records.length;
  return {
    latencyP50: Math.round(percentile(latencies, 0.5)),
    latencyP95: Math.round(percentile(latencies, 0.95)),
    successRate: Math.round((successes / records.length) * 1000) / 1000,
    avgResponseSize: Math.round(avgResponseSize),
  };
}

export function buildObservedTools(records: ProxyCallRecord[]): ObservedTool[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.toolName, (counts.get(record.toolName) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({
      name,
      description: `Observed from ${count} proxy call${count === 1 ? '' : 's'}`,
      inputSchema: { type: 'object', additionalProperties: true },
    }));
}
