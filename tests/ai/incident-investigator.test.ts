import { describe, expect, it, vi } from 'vitest';
import type { StoredSemanticAudit } from '../../src/ai/semantic-audit-store.js';

const mockRecord: StoredSemanticAudit = {
  id: 'sem-test-001',
  tenantId: 'default',
  requestId: 'inv-test-1',
  serverName: 'filesystem',
  toolName: 'read_file',
  syncDecision: { action: 'block', rule: 'path-guard', reason: 'sensitive path' },
  semanticAudit: {
    suspicious: true,
    confidence: 0.91,
    categories: ['path-traversal'],
    reasoning: 'Attempt to read sensitive file',
  },
  timestamp: new Date().toISOString(),
};

vi.mock('../../src/ai/semantic-audit-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ai/semantic-audit-store.js')>();
  return {
    ...actual,
    loadSemanticAuditRecordsAsync: vi.fn(async () => [mockRecord]),
    loadSemanticAuditRecordsWithTenantFallback: vi.fn(async () => ({
      records: [mockRecord],
      resolvedTenantId: 'default',
    })),
  };
});

describe('incident-investigator', () => {
  it('investigates a semantic audit trigger with citations', async () => {
    const { investigateIncident } = await import('../../src/ai/incident-investigator.js');
    const investigation = await investigateIncident({
      triggerId: mockRecord.id,
      triggerType: 'semantic_flag',
      useLlm: false,
    });

    expect(investigation).not.toBeNull();
    expect(investigation!.citations.some((c) => c.id === mockRecord.id)).toBe(true);
    expect(investigation!.hypotheses.length).toBeGreaterThan(0);
    expect(investigation!.recommendations.some((r) => r.action === 'open_threat_lab')).toBe(true);
    expect(investigation!.narrative).toContain(mockRecord.id);
    expect(investigation!.intentGraph).toBeDefined();
    expect(investigation!.killChainNarrative).toBeTruthy();
  });

  it('returns null for unknown trigger', async () => {
    const { investigateIncident } = await import('../../src/ai/incident-investigator.js');
    const result = await investigateIncident({ triggerId: 'nonexistent-id', useLlm: false });
    expect(result).toBeNull();
  });

  it('resolves semantic: prefixed trigger ids', async () => {
    const { investigateIncident } = await import('../../src/ai/incident-investigator.js');
    const investigation = await investigateIncident({
      triggerId: `semantic:${mockRecord.id}`,
      triggerType: 'semantic_flag',
      useLlm: false,
    });
    expect(investigation).not.toBeNull();
    expect(investigation!.triggerId).toBe(`semantic:${mockRecord.id}`);
  });
});
