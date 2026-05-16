import { describe, it, expect } from 'vitest';
import { CostAuditor } from '../../src/services/cost-auditor.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { PricingClient } from '../../src/clients/pricing-client.js';

describe('CostAuditor', () => {
  it('returns zero cost when no records', async () => {
    const db = new HistoryDatabase(':memory:');
    const pricing = new PricingClient();
    const auditor = new CostAuditor(pricing, db);
    const report = await auditor.auditServer({ name: 'test', transport: 'stdio' });
    expect(report.tokensUsed).toBe(0);
    expect(report.toolBreakdown).toHaveLength(0);
    expect(report.note).toContain('No recorded call data');
    db.close();
  });

  it('correctly aggregates real request/response tokens', async () => {
    const db = new HistoryDatabase(':memory:');
    const pricing = new PricingClient();
    const auditor = new CostAuditor(pricing, db);

    await db.addCallRecord({
      serverName: 'test', toolName: 'echo',
      requestTokens: 100, responseTokens: 200, totalTokens: 300,
      durationMs: 50, timestamp: new Date().toISOString(),
    });
    await db.addCallRecord({
      serverName: 'test', toolName: 'echo',
      requestTokens: 150, responseTokens: 250, totalTokens: 400,
      durationMs: 60, timestamp: new Date().toISOString(),
    });
    await db.addCallRecord({
      serverName: 'test', toolName: 'add',
      requestTokens: 80, responseTokens: 20, totalTokens: 100,
      durationMs: 30, timestamp: new Date().toISOString(),
    });
    db.flush();

    const report = await auditor.auditServer({ name: 'test', transport: 'stdio' });
    expect(report.tokensUsed).toBe(800);
    expect(report.inputTokens).toBe(330);
    expect(report.outputTokens).toBe(470);
    expect(report.toolBreakdown).toHaveLength(2);

    const echo = report.toolBreakdown.find((t) => t.toolName === 'echo');
    expect(echo).toBeDefined();
    expect(echo!.tokens).toBe(700);
    expect(echo!.calls).toBe(2);

    const add = report.toolBreakdown.find((t) => t.toolName === 'add');
    expect(add).toBeDefined();
    expect(add!.tokens).toBe(100);
    expect(add!.calls).toBe(1);

    db.close();
  });

  it('handles single call correctly', async () => {
    const db = new HistoryDatabase(':memory:');
    const pricing = new PricingClient();
    const auditor = new CostAuditor(pricing, db);

    await db.addCallRecord({
      serverName: 'single', toolName: 'search',
      requestTokens: 500, responseTokens: 1000, totalTokens: 1500,
      durationMs: 100, timestamp: new Date().toISOString(),
    });
    db.flush();

    const report = await auditor.auditServer({ name: 'single', transport: 'stdio' });
    expect(report.tokensUsed).toBe(1500);
    expect(report.inputTokens).toBe(500);
    expect(report.outputTokens).toBe(1000);
    expect(report.toolBreakdown).toHaveLength(1);
    expect(report.toolBreakdown[0].tokens).toBe(1500);

    db.close();
  });
});