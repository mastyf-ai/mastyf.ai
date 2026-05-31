import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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
  const envKeys = ['GUARDIAN_AI_ATTACK_STATE_PATH'] as const;
  const savedEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

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

  it('falls back to history.db when attack state counters lack chart series', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'attack-state-'));
    const attackPath = join(dir, '.attack-learning-state.json');
    writeFileSync(
      attackPath,
      JSON.stringify({
        version: 1,
        totalEvents: 99,
        ruleToolCounts: {},
        recentBlocks: [],
      }),
    );
    savedEnv.GUARDIAN_AI_ATTACK_STATE_PATH = process.env.GUARDIAN_AI_ATTACK_STATE_PATH;
    process.env.GUARDIAN_AI_ATTACK_STATE_PATH = attackPath;

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

    try {
      const bundle = await buildVisualsData({
        windowDays: '1h',
        historyDb: mockDb(records),
        tenantId: 'default',
      });
      expect(bundle.instantLearning.source).toBe('history-db-fallback');
      expect(bundle.instantLearning.ruleToolPairs.length).toBeGreaterThan(0);
      expect(bundle.instantLearning.blocksPerMinute.length).toBeGreaterThan(0);
      expect(bundle.meta.emptyReasons?.instantLearning).toMatch(/chart series are empty/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
