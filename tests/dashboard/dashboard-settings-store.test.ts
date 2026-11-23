import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Point the store's home directory at a throwaway folder (works on every OS, unlike HOME).
const home = mkdtempSync(join(tmpdir(), 'mastyf-settings-'));
vi.mock('os', async (orig) => ({ ...(await orig<typeof import('os')>()), homedir: () => home }));

const store = await import('../../src/utils/dashboard-settings-store.js');

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('cost budget', () => {
  beforeAll(() => { delete process.env.MASTYF_AI_COST_BUDGET_USD; });

  it('has no budget until one is set', () => {
    expect(store.readCostBudget('t1')).toMatchObject({ monthlyUsd: null, source: null, alertAtPct: 80 });
  });

  it('falls back to MASTYF_AI_COST_BUDGET_USD', () => {
    process.env.MASTYF_AI_COST_BUDGET_USD = '120';
    expect(store.readCostBudget('t-env')).toMatchObject({ monthlyUsd: 120, source: 'env' });
    delete process.env.MASTYF_AI_COST_BUDGET_USD;
  });

  it('saves, clamps the alert threshold, and can be cleared', () => {
    const saved = store.writeCostBudget('t1', { monthlyUsd: 300, alertAtPct: 250 }, 'alice');
    expect(saved).toMatchObject({ monthlyUsd: 300, alertAtPct: 100, source: 'dashboard', updatedBy: 'alice' });
    expect(store.writeCostBudget('t1', { monthlyUsd: null }, 'alice').monthlyUsd).toBeNull();
  });

  it('rejects nonsense amounts', () => {
    expect(() => store.writeCostBudget('t1', { monthlyUsd: -5 }, null)).toThrow(/positive/);
    expect(() => store.writeCostBudget('t1', { monthlyUsd: Number.NaN }, null)).toThrow();
  });

  it('pro-rates the monthly budget to the reporting window', () => {
    expect(store.budgetForWindow(300, 30)).toBe(300);
    expect(store.budgetForWindow(300, 7)).toBe(70);
    expect(store.budgetForWindow(null, 7)).toBeNull();
  });

  it('keeps tenants apart and ignores unsafe tenant ids', () => {
    store.writeCostBudget('tenant-a', { monthlyUsd: 10 }, null);
    expect(store.readCostBudget('tenant-b').monthlyUsd).toBeNull();
    expect(() => store.readCostBudget('../../etc')).not.toThrow();
  });
});

describe('policy history', () => {
  const v1 = 'policy:\n  mode: block\n  rules:\n    - name: a\n';
  const v2 = 'policy:\n  mode: audit\n  rules:\n    - name: a\n    - name: b\n';

  it('records versions newest first with rule count and mode', async () => {
    const first = store.recordPolicyVersion('h', v1, null, 'before-first-save');
    await new Promise((r) => setTimeout(r, 5));
    const second = store.recordPolicyVersion('h', v2, 'bob', 'save');
    expect(first?.ruleCount).toBe(1);
    expect(second).toMatchObject({ ruleCount: 2, mode: 'audit', savedBy: 'bob', reason: 'save' });
    expect(store.listPolicyVersions('h').map((v) => v.id)).toEqual([second!.id, first!.id]);
  });

  it('skips a save identical to the newest version', () => {
    expect(store.recordPolicyVersion('h', v2, 'bob', 'save')).toBeNull();
  });

  it('reads a version back and refuses ids that are not version ids', () => {
    const [latest] = store.listPolicyVersions('h');
    expect(store.readPolicyVersion('h', latest.id)?.yaml).toBe(v2);
    expect(store.readPolicyVersion('h', '../../secret')).toBeNull();
  });
});

describe('policy edits outside the editor', () => {
  it('keeps the original before the first edit, then the edited version', () => {
    const before = 'policy:\n  mode: block\n  rules:\n    - name: x\n';
    const after = 'policy:\n  mode: block\n  rules:\n    - name: x\n      enabled: false\n';
    const id = store.recordPolicyEdit('edits', before, after, 'carol');
    const versions = store.listPolicyVersions('edits');
    expect(versions.map((v) => v.reason)).toEqual(['rule-change', 'before-first-save']);
    expect(versions[0]).toMatchObject({ id, savedBy: 'carol' });
  });
});
