import { describe, expect, it } from 'vitest';
import {
  buildQuarantineRule,
  type MonitorThreatContext,
} from '../../src/utils/monitor-quarantine-enforcement.js';

describe('monitor quarantine enforcement', () => {
  it('builds a semantic rule from semantic context', () => {
    const context: MonitorThreatContext = {
      sourceKind: 'semantic',
      row: {
        id: 'THR-S1',
        threatKey: 'semantic:abc123',
        type: 'Semantic Prompt Injection',
        source: '10.0.0.2',
        severity: 'critical',
        status: 'monitored',
      },
      semantic: {
        id: 'abc123',
        tenantId: 'default',
        requestId: 'req-1',
        serverName: 'filesystem',
        toolName: 'read_file',
        syncDecision: { action: 'flag', rule: 'semantic', reason: 'suspicious' },
        semanticAudit: {
          suspicious: true,
          confidence: 0.91,
          reasons: ['prompt injection'],
        },
        timestamp: new Date().toISOString(),
        argumentsSnapshot: { path: '/etc/passwd' },
      },
    };
    const out = buildQuarantineRule(context);
    expect(out.rule?.name).toContain('quarantine-semantic');
    expect(out.rule?.action).toBe('block');
    expect(out.confidence).toBeGreaterThan(0.8);
  });

  it('returns no rule for unknown context', () => {
    const context: MonitorThreatContext = {
      sourceKind: 'unknown',
      row: {
        id: 'THR-U1',
        threatKey: 'custom:no-source',
        type: 'Policy violation',
        source: '10.0.0.3',
        severity: 'high',
        status: 'blocked',
      },
    };
    const out = buildQuarantineRule(context);
    expect(out.rule).toBeNull();
    expect(out.detail).toContain('No semantic/block context');
  });
});
