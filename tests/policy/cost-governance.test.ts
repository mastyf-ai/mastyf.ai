import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import { PolicyConfig, CallContext } from '../../src/policy/policy-types.js';
import { getDailyBudgetCapUsd, CostAuditor } from '../../src/services/cost-auditor.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { PricingClient } from '../../src/clients/pricing-client.js';

const costPolicy: PolicyConfig = {
  version: '1.0',
  policy: {
    mode: 'block',
    rules: [
      {
        name: 'cost-rate-limit',
        action: 'block',
        maxCallsPerMinute: 3,
      },
      {
        name: 'cost-token-budget',
        action: 'block',
        maxTokens: 500,
      },
    ],
  },
};

function ctx(overrides: Partial<CallContext> = {}): CallContext {
  return {
    serverName: 'github',
    toolName: 'search',
    arguments: {},
    requestId: 'r1',
    requestTokens: 100,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('enterprise cost governance policy', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine(costPolicy);
  });

  it('blocks when token budget exceeded', () => {
    const decision = engine.evaluate(ctx({ requestTokens: 2000 }));
    expect(decision.action).toBe('block');
    expect(decision.rule).toBe('cost-token-budget');
  });

  it('blocks when per-minute rate limit exceeded', () => {
    for (let i = 0; i < 3; i++) {
      expect(engine.evaluate(ctx({ requestId: `id-${i}` })).action).toBe('pass');
    }
    const blocked = engine.evaluate(ctx({ requestId: 'id-overflow' }));
    expect(blocked.action).toBe('block');
    expect(blocked.rule).toBe('cost-rate-limit');
  });
});

describe('GUARDIAN_DAILY_BUDGET_USD', () => {
  const prev = process.env.GUARDIAN_DAILY_BUDGET_USD;

  afterEach(() => {
    if (prev === undefined) delete process.env.GUARDIAN_DAILY_BUDGET_USD;
    else process.env.GUARDIAN_DAILY_BUDGET_USD = prev;
  });

  it('reads daily cap from env', () => {
    process.env.GUARDIAN_DAILY_BUDGET_USD = '42.5';
    expect(getDailyBudgetCapUsd()).toBe(42.5);
  });

  it('detects exceeded daily spend', async () => {
    process.env.GUARDIAN_DAILY_BUDGET_USD = '1';
    const db = new HistoryDatabase(':memory:');
    const auditor = new CostAuditor(new PricingClient(), db);
    await db.addCallRecord({
      serverName: 's1',
      toolName: 't1',
      requestTokens: 10,
      responseTokens: 10,
      totalTokens: 20,
      durationMs: 1,
      timestamp: new Date().toISOString(),
      costUsd: 1.5,
    });
    db.flush();
    const check = await auditor.isDailyBudgetExceeded();
    expect(check.exceeded).toBe(true);
    expect(check.spentUsd).toBeGreaterThanOrEqual(1.5);
    db.close();
  });
});
