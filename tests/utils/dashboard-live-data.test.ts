import { describe, expect, it } from 'vitest';
import { isDemoThreatId, parseCostBudgetUsd } from '../../src/utils/dashboard-live-data.js';

describe('dashboard-live-data', () => {
  it('detects demo threat IDs', () => {
    expect(isDemoThreatId('CVE-2026-TEST1')).toBe(true);
    expect(isDemoThreatId('osv-GHSA-real')).toBe(false);
  });

  it('parses cost budget from env', () => {
    const prev = process.env.GUARDIAN_COST_BUDGET_USD;
    process.env.GUARDIAN_COST_BUDGET_USD = '99.5';
    expect(parseCostBudgetUsd()).toBe(99.5);
    if (prev === undefined) {
      delete process.env.GUARDIAN_COST_BUDGET_USD;
    } else {
      process.env.GUARDIAN_COST_BUDGET_USD = prev;
    }
    expect(parseCostBudgetUsd()).toBe(prev ? parseFloat(prev) : null);
  });
});
