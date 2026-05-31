import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ai/semantic-audit-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ai/semantic-audit-store.js')>();
  return {
    ...actual,
    loadSemanticAuditRecordsWithTenantFallback: vi.fn(async () => ({
      records: [],
      resolvedTenantId: 'default',
    })),
  };
});

vi.mock('../../src/utils/swarm-artifacts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/swarm-artifacts.js')>();
  return {
    ...actual,
    findThreatLabCandidateUngated: vi.fn(() => ({
      id: 'threat-lab-001',
      fingerprint: 'fp-1',
      attackClass: 'threat-intel-cve',
      hypothesis: 'ReDoS in MCP SDK',
      confidence: 0.75,
      provenance: { source: 'threat-intel', inputFingerprint: 'osv-GHSA-test' },
      corpusCandidate: { toolName: 'search', expected: 'block' },
      policyRule: { name: 'threat-lab-rule' },
    })),
  };
});

describe('incident-investigator threat lab fallback', () => {
  it('builds investigation from Threat Lab candidate when no semantic audit exists', async () => {
    const { investigateIncident } = await import('../../src/ai/incident-investigator.js');
    const investigation = await investigateIncident({
      triggerId: 'threat-lab-001',
      useLlm: false,
    });
    expect(investigation).not.toBeNull();
    expect(investigation!.hypotheses[0]?.attackClass).toBe('threat-intel-cve');
    expect(investigation!.citations.some((c) => c.id === 'threat-lab-001')).toBe(true);
    expect(investigation!.recommendations.some((r) => r.action === 'open_threat_lab')).toBe(true);
  });
});
