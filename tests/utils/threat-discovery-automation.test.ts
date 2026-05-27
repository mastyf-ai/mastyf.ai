import { describe, expect, it } from 'vitest';
import { mapAutomationStatus } from '../../deploy/dashboard-spa/lib/threat-discovery-automation.js';

describe('mapAutomationStatus', () => {
  it('maps scheduler + pipeline fields from API payloads', () => {
    const mapped = mapAutomationStatus(
      {
        running: true,
        lastRunAt: '2026-05-27T17:05:23.000Z',
        totalRuns: 58,
        lastRunStatus: 'success',
      },
      {
        pipeline: {
          queued: 3,
          writesThisHour: 2,
          maxPerHour: 20,
          enabled: true,
          sources: { semantic: true, blocks: false, threatIntel: true },
        },
        llm: { ok: true, model: 'qwen3:8b' },
        autoCorpus: {
          stats: {
            total: 11,
            last24h: 7,
          },
        },
      },
    );

    expect(mapped.schedulerRunning).toBe(true);
    expect(mapped.totalRuns).toBe(58);
    expect(mapped.lastRunOk).toBe(true);
    expect(mapped.pipelineHealth.queued).toBe(3);
    expect(mapped.pipelineHealth.writesThisHour).toBe(2);
    expect(mapped.pipelineHealth.enabled).toBe(true);
    expect(mapped.pipelineHealth.sources.semantic).toBe(true);
    expect(mapped.llm.ok).toBe(true);
    expect(mapped.llm.model).toBe('qwen3:8b');
    expect(mapped.autoCorpus.total).toBe(11);
    expect(mapped.autoCorpus.last24h).toBe(7);
  });

  it('falls back to safe defaults when fields are missing', () => {
    const mapped = mapAutomationStatus({}, {});
    expect(mapped.schedulerRunning).toBe(false);
    expect(mapped.lastRunAt).toBeNull();
    expect(mapped.totalRuns).toBe(0);
    expect(mapped.lastRunOk).toBe(false);
    expect(mapped.pipelineHealth.queued).toBe(0);
    expect(mapped.pipelineHealth.writesThisHour).toBe(0);
    expect(mapped.pipelineHealth.maxPerHour).toBe(20);
    expect(mapped.pipelineHealth.enabled).toBe(false);
    expect(mapped.llm.ok).toBe(false);
    expect(mapped.autoCorpus.total).toBe(0);
  });
});
