import { describe, expect, it } from 'vitest';
import type { ProxyCallRecord } from '../../src/types.js';
import {
  buildObservedTools,
  computeMeasuredPerformance,
  filterRecordsByWindow,
  percentile,
} from '../../src/utils/real-metrics.js';

function record(overrides: Partial<ProxyCallRecord> = {}): ProxyCallRecord {
  return {
    serverName: 'filesystem',
    toolName: 'read_file',
    requestTokens: 10,
    responseTokens: 25,
    totalTokens: 35,
    durationMs: 100,
    timestamp: new Date('2026-07-03T00:00:00.000Z').toISOString(),
    blocked: false,
    ...overrides,
  };
}

describe('real metric helpers', () => {
  it('computes measured performance from proxy call records', () => {
    const perf = computeMeasuredPerformance([
      record({ durationMs: 50, responseTokens: 10 }),
      record({ durationMs: 100, responseTokens: 20 }),
      record({ durationMs: 400, responseTokens: 30, blocked: true }),
      record({ durationMs: 800, responseTokens: 40 }),
    ]);

    expect(perf).toEqual({
      latencyP50: 100,
      latencyP95: 400,
      successRate: 0.75,
      avgResponseSize: 100,
    });
  });

  it('filters by window and derives observed tools', () => {
    const now = Date.parse('2026-07-03T00:00:00.000Z');
    const records = filterRecordsByWindow([
      record({ toolName: 'read_file', timestamp: '2026-07-02T00:00:00.000Z' }),
      record({ toolName: 'write_file', timestamp: '2026-07-01T00:00:00.000Z' }),
      record({ toolName: 'old_tool', timestamp: '2026-06-01T00:00:00.000Z' }),
    ], 7, now);

    expect(records.map((r) => r.toolName)).toEqual(['read_file', 'write_file']);
    expect(buildObservedTools(records).map((t) => t.name)).toEqual(['read_file', 'write_file']);
  });

  it('returns zero/null for empty measurements instead of defaults', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(computeMeasuredPerformance([])).toBeNull();
  });
});
