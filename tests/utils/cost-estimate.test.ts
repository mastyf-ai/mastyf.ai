import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { validateCostSourceAtStartup } from '../../src/utils/cost-estimate.js';

describe('validateCostSourceAtStartup', () => {
  const keys = ['GUARDIAN_COST_SOURCE', 'GUARDIAN_COST_ALLOW_ESTIMATES', 'NODE_ENV', 'GUARDIAN_STRICT_MODE'] as const;
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  beforeEach(() => {
    for (const k of keys) prev[k] = process.env[k];
  });

  it('allows model-only by default', () => {
    delete process.env.GUARDIAN_COST_SOURCE;
    expect(() => validateCostSourceAtStartup()).not.toThrow();
  });

  it('rejects simulated alias', () => {
    process.env.GUARDIAN_COST_SOURCE = 'simulated';
    expect(() => validateCostSourceAtStartup()).toThrow(/simulated/i);
  });

  it('rejects estimated in production without opt-in', () => {
    process.env.GUARDIAN_COST_SOURCE = 'estimated';
    process.env.NODE_ENV = 'production';
    delete process.env.GUARDIAN_COST_ALLOW_ESTIMATES;
    expect(() => validateCostSourceAtStartup()).toThrow(/GUARDIAN_COST_ALLOW_ESTIMATES/i);
  });
});
