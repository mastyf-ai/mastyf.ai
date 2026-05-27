import { describe, expect, it, vi } from 'vitest';
import type { StoredSemanticAudit } from '../../src/ai/semantic-audit-store.js';

function mockAudit(i: number): StoredSemanticAudit {
  return {
    id: `trib-${i}`,
    tenantId: 'default',
    requestId: `r${i}`,
    serverName: 'filesystem',
    toolName: `tool_${i}`,
    syncDecision: { action: 'block', rule: 'path-guard', reason: 'blocked' },
    semanticAudit: {
      suspicious: true,
      confidence: 0.62,
      categories: ['path-traversal'],
      reasoning: 'borderline',
    },
    timestamp: new Date().toISOString(),
    labeled: false,
  };
}

const manyRecords = Array.from({ length: 15 }, (_, i) => mockAudit(i));

vi.mock('../../src/ai/semantic-audit-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ai/semantic-audit-store.js')>();
  return {
    ...actual,
    loadSemanticAuditRecordsAsync: vi.fn(async () => manyRecords),
  };
});

import { runTribunalDebate, runTribunalForQueue } from '../../src/ai/swarm-debate-tribunal.js';

const mockRecord: StoredSemanticAudit = {
  id: 'trib-1',
  tenantId: 'default',
  requestId: 'r1',
  serverName: 'filesystem',
  toolName: 'read_file',
  syncDecision: { action: 'block', rule: 'path-guard', reason: 'blocked' },
  semanticAudit: {
    suspicious: true,
    confidence: 0.62,
    categories: ['path-traversal'],
    reasoning: 'borderline path read',
  },
  timestamp: new Date().toISOString(),
};

describe('swarm-debate-tribunal', () => {
  it('runs heuristic tribunal debate without LLM', async () => {
    const debate = await runTribunalDebate(mockRecord, { useLlm: false });
    expect(debate.arguments.length).toBe(3);
    expect(debate.verdict.recommendedLabel).toBeTruthy();
    expect(debate.transcript.length).toBeGreaterThan(0);
  });

  it('batches debates and reports remaining eligible beyond batch limit', async () => {
    const result = await runTribunalForQueue({ limit: 10, useLlm: false });
    expect(result.debates.length).toBe(10);
    expect(result.batchLimit).toBe(10);
    expect(result.eligibleTotal).toBeGreaterThanOrEqual(10);
    expect(result.remainingEligible).toBe(result.eligibleTotal - result.debates.length);
    expect(result.remainingEligible).toBeGreaterThan(0);
  });
});
