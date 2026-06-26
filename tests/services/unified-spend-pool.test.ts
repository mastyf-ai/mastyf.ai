import { afterEach, describe, expect, it } from 'vitest';
import {
  resetUnifiedSpendPoolForTests,
  tryReserveSpend,
  releaseReservedSpend,
} from '../../src/services/unified-spend-pool.js';

describe('unified-spend-pool', () => {
  afterEach(() => {
    resetUnifiedSpendPoolForTests();
    delete process.env.MASTYF_AI_TENANT_TOKENS_PER_MIN;
    delete process.env.MASTYF_AI_TENANT_DAILY_BUDGET_JSON;
    delete process.env.MASTYF_AI_DAILY_BUDGET_USD;
  });

  it('allows reserve when caps unset', async () => {
    const result = await tryReserveSpend({ tenantId: 't1', tokens: 100, estimatedUsd: 0 });
    expect(result.ok).toBe(true);
    expect(result.reservationId).toBeTruthy();
  });

  it('denies when single request exceeds tokens per minute cap', async () => {
    process.env.MASTYF_AI_TENANT_TOKENS_PER_MIN = '50';
    const result = await tryReserveSpend({ tenantId: 't1', tokens: 100, estimatedUsd: 0 });
    expect(result.ok).toBe(false);
    expect(result.rule).toBe('unified-spend-pool');
  });

  it('releases reservation and allows subsequent reserve', async () => {
    process.env.MASTYF_AI_TENANT_TOKENS_PER_MIN = '100';
    const tenant = `rollback-${Date.now()}`;
    const first = await tryReserveSpend({ tenantId: tenant, tokens: 80, estimatedUsd: 0 });
    expect(first.ok).toBe(true);
    await releaseReservedSpend(first.reservationId);
    const second = await tryReserveSpend({ tenantId: tenant, tokens: 80, estimatedUsd: 0 });
    expect(second.ok).toBe(true);
  });
});
