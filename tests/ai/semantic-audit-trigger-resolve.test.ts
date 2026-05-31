import { describe, expect, it } from 'vitest';
import {
  findSemanticAuditRecord,
  normalizeSemanticAuditTriggerId,
} from '../../src/ai/semantic-audit-store.js';
import type { StoredSemanticAudit } from '../../src/ai/semantic-audit-store.js';

const sample: StoredSemanticAudit = {
  id: '1779451234099-hzn9poh',
  tenantId: 'default',
  requestId: 'req-1',
  serverName: 'filesystem',
  toolName: 'read_file',
  syncDecision: { action: 'block', rule: 'path-guard', reason: 'traversal' },
  semanticAudit: {
    suspicious: true,
    confidence: 0.88,
    categories: ['path-traversal'],
    reasoning: 'sensitive path',
  },
  timestamp: new Date().toISOString(),
};

describe('semantic audit trigger resolution', () => {
  it('normalizes semantic: prefix', () => {
    expect(normalizeSemanticAuditTriggerId(`semantic:${sample.id}`)).toBe(sample.id);
  });

  it('finds records by id or semantic: prefix', () => {
    expect(findSemanticAuditRecord([sample], sample.id)?.id).toBe(sample.id);
    expect(findSemanticAuditRecord([sample], `semantic:${sample.id}`)?.id).toBe(sample.id);
    expect(findSemanticAuditRecord([sample], 'missing')).toBeUndefined();
  });
});
