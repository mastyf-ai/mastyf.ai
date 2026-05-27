import { describe, expect, it } from 'vitest';
import { buildVisualsData } from '../../src/utils/export-visuals-data.js';
import type { IDatabase } from '../../src/database/database-interface.js';
import type { ProxyCallRecord } from '../../src/types.js';

function mockDb(records: ProxyCallRecord[]): IDatabase {
  return {
    getDistinctActiveServers: async () => ['test-server'],
    getCallRecordsForServer: async () => records,
  } as unknown as IDatabase;
}

describe('buildVisualsData', () => {
  it('includes traffic from SQLite-style timestamps in the selected window', async () => {
    const now = Date.now();
    const ts = new Date(now - 20 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    const records: ProxyCallRecord[] = [
      {
        serverName: 'test-server',
        toolName: 'read_file',
        blocked: true,
        blockRule: 'path-guard',
        costUsd: 0,
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        durationMs: 12,
        timestamp: ts,
      },
    ];

    const bundle = await buildVisualsData({
      windowDays: '1h',
      historyDb: mockDb(records),
      tenantId: 'default',
    });

    expect(bundle.traffic.hasData).toBe(true);
    expect(bundle.traffic.totalCalls).toBe(1);
    expect(bundle.traffic.hourly.some((h) => h.calls > 0)).toBe(true);
    expect(bundle.traffic.topTools[0]?.tool).toBe('read_file');
  });
});
