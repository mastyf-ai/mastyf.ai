import { afterEach, describe, expect, it } from 'vitest';
import {
  resetUnifiedSpendPoolForTests,
  tryReserveSpend,
  releaseReservedSpend,
} from '../../src/services/unified-spend-pool.js';

const hasRedis = Boolean(process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL);

describe.skipIf(!hasRedis)('unified-spend-pool redis race', () => {
  afterEach(() => {
    resetUnifiedSpendPoolForTests();
    delete process.env.MASTYF_AI_TENANT_TOKENS_PER_MIN;
    delete process.env.MASTYF_AI_TENANT_USD_PER_MIN;
    delete process.env.MASTYF_AI_DAILY_BUDGET_USD;
  });

  it('allows exactly N requests under 1000 concurrent flood', async () => {
    process.env.MASTYF_AI_TENANT_TOKENS_PER_MIN = '500';
    const tenant = `race-${Date.now()}`;
    const tokensPerReq = 10;
    const maxAllowed = 50;
    const concurrency = 1000;

    const results = await Promise.all(
      Array.from({ length: concurrency }, () =>
        tryReserveSpend({
          tenantId: tenant,
          sessionKey: 'race',
          tokens: tokensPerReq,
          estimatedUsd: 0,
        }),
      ),
    );

    const allowed = results.filter((r) => r.ok).length;
    const denied = results.filter((r) => !r.ok).length;
    expect(allowed).toBe(maxAllowed);
    expect(denied).toBe(concurrency - maxAllowed);

    for (const r of results.filter((x) => x.ok && x.reservationId)) {
      await releaseReservedSpend(r.reservationId);
    }
  });

  it('enforces tokens/min + USD/min + day atomically', async () => {
    process.env.MASTYF_AI_TENANT_TOKENS_PER_MIN = '1000';
    process.env.MASTYF_AI_TENANT_USD_PER_MIN = '0.01';
    process.env.MASTYF_AI_DAILY_BUDGET_USD = '0.02';
    const tenant = `multi-${Date.now()}`;

    const ok = await tryReserveSpend({
      tenantId: tenant,
      tokens: 100,
      estimatedUsd: 0.005,
    });
    expect(ok.ok).toBe(true);

    const overDay = await tryReserveSpend({
      tenantId: tenant,
      tokens: 10,
      estimatedUsd: 0.02,
    });
    expect(overDay.ok).toBe(false);
  });
});
