import { describe, expect, it } from 'vitest';
import type { ProxyCallRecord } from '../../src/types.js';
import { filterRecordsInWindow, parseRecordTimestamp, windowRangeMs } from '../../src/utils/time-buckets.js';

describe('time-buckets', () => {
  it('parseRecordTimestamp treats SQLite datetime as UTC', () => {
    const ts = parseRecordTimestamp('2026-05-27 16:11:20');
    expect(Number.isFinite(ts)).toBe(true);
    expect(new Date(ts).toISOString()).toBe('2026-05-27T16:11:20.000Z');
  });

  it('filterRecordsInWindow keeps records inside bounds', () => {
    const now = Date.now();
    const { startMs, endMs } = windowRangeMs(1 / 24, now);
    const inside: ProxyCallRecord = {
      serverName: 's',
      toolName: 't',
      blocked: false,
      timestamp: new Date(now - 30 * 60_000).toISOString().slice(0, 19).replace('T', ' '),
    };
    const outside: ProxyCallRecord = {
      serverName: 's',
      toolName: 't',
      blocked: false,
      timestamp: new Date(now - 3 * 60 * 60_000).toISOString().slice(0, 19).replace('T', ' '),
    };
    const filtered = filterRecordsInWindow([inside, outside], startMs, endMs);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.toolName).toBe('t');
  });
});
