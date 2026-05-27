import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findPolicyRuleByName } from '../../src/ai/policy-applier.js';
import {
  buildIntelQuarantinePolicyDetail,
  buildMonitorQuarantinePolicyDetail,
} from '../../src/utils/quarantine-policy-detail.js';
import {
  resolveMonitorThreatContext,
  type MonitorThreatContext,
} from '../../src/utils/monitor-quarantine-enforcement.js';

vi.mock('../../src/utils/monitor-quarantine-enforcement.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/monitor-quarantine-enforcement.js')>();
  return {
    ...actual,
    resolveMonitorThreatContext: vi.fn(),
  };
});

const mockedResolve = vi.mocked(resolveMonitorThreatContext);

describe('quarantine policy detail', () => {
  let tmpDir: string;
  let policyPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'quarantine-policy-detail-'));
    policyPath = join(tmpDir, 'policy.yaml');
    writeFileSync(
      policyPath,
      [
        'version: "1.0"',
        'policy:',
        '  mode: block',
        '  rules:',
        '    - name: threat-CVE-2024-1',
        '      action: block',
        '      patterns: ["eval\\\\("]',
        '',
      ].join('\n'),
    );
    process.env.GUARDIAN_POLICY_PATH = policyPath;
  });

  afterEach(() => {
    delete process.env.GUARDIAN_POLICY_PATH;
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('findPolicyRuleByName returns rule from YAML', () => {
    const rule = findPolicyRuleByName('threat-CVE-2024-1', policyPath);
    expect(rule?.name).toBe('threat-CVE-2024-1');
    expect(rule?.action).toBe('block');
  });

  it('buildIntelQuarantinePolicyDetail includes triggered intel and applied rule', () => {
    const detail = buildIntelQuarantinePolicyDetail({
      id: 'CVE-2024-1',
      source: 'NVD',
      severity: 'HIGH',
      description: 'Remote code execution',
      remediation: 'Upgrade package',
      publishedAt: new Date().toISOString(),
      signature: 'eval\\(',
      quarantinedAt: new Date().toISOString(),
      appliedRuleName: 'threat-CVE-2024-1',
      policyPath,
    });
    expect(detail.source).toBe('intel');
    expect(detail.triggered?.kind).toBe('threat_intel');
    expect(detail.appliedRule?.name).toBe('threat-CVE-2024-1');
    expect(detail.suggestedRule?.name).toBe('threat-CVE-2024-1');
  });

  it('buildMonitorQuarantinePolicyDetail returns proxy_block trigger from context', async () => {
    const record = {
      id: 'THR-B1',
      threatKey: 'block:filesystem:read_file:2026-05-27T12:00:00.000Z',
      type: 'SQL Injection Attempt',
      source: '10.1.2.3',
      severity: 'high' as const,
      status: 'blocked' as const,
      quarantinedAt: new Date().toISOString(),
      appliedRuleName: 'quarantine-block-thr-b1',
      policyPath,
      enforcementStatus: 'applied' as const,
      sourceKind: 'block' as const,
    };
    const context: MonitorThreatContext = {
      sourceKind: 'block',
      row: record,
      record: {
        serverName: 'filesystem',
        toolName: 'read_file',
        timestamp: '2026-05-27T12:00:00.000Z',
        blocked: true,
        blockRule: 'block-sql-injection',
        blockReason: 'Matched SQL pattern',
        requestId: 1,
        requestTokens: 0,
        durationMs: 10,
      },
    };
    mockedResolve.mockResolvedValue(context);

    const detail = await buildMonitorQuarantinePolicyDetail(record, 'default', null);
    expect(detail.triggered?.kind).toBe('proxy_block');
    expect(detail.triggered?.ruleName).toBe('block-sql-injection');
    expect(detail.triggered?.reason).toBe('Matched SQL pattern');
    expect(detail.suggestedRule?.name).toContain('quarantine-block');
  });

  it('buildMonitorQuarantinePolicyDetail returns semantic_flag trigger from context', async () => {
    const record = {
      id: 'THR-S9',
      threatKey: 'semantic:sem-9',
      type: 'Semantic Prompt Injection',
      source: '10.9.9.9',
      severity: 'critical' as const,
      status: 'monitored' as const,
      quarantinedAt: new Date().toISOString(),
      enforcementStatus: 'applied' as const,
      sourceKind: 'semantic' as const,
    };
    mockedResolve.mockResolvedValue({
      sourceKind: 'semantic',
      row: record,
      semantic: {
        id: 'sem-9',
        tenantId: 'default',
        requestId: 'r1',
        serverName: 'filesystem',
        toolName: 'read_file',
        syncDecision: { action: 'block', rule: 'semantic-prompt', reason: 'injection detected' },
        semanticAudit: { suspicious: true, confidence: 0.92, reasons: ['injection'] },
        timestamp: new Date().toISOString(),
      },
    });

    const detail = await buildMonitorQuarantinePolicyDetail(record, 'default', null);
    expect(detail.triggered?.kind).toBe('semantic_flag');
    expect(detail.triggered?.ruleName).toBe('semantic-prompt');
    expect(detail.triggered?.reason).toBe('injection detected');
  });
});
