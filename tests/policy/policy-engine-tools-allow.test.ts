import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { PolicyConfig, CallContext } from '../../src/policy/policy-types.js';

function ctx(toolName: string, overrides: Partial<CallContext> = {}): CallContext {
  return {
    serverName: 'srv',
    toolName,
    requestId: '1',
    requestTokens: 10,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('PolicyEngine tools.allow scope semantics', () => {
  it('applies rate limit only to scoped tool, not global block', () => {
    const config: PolicyConfig = {
      version: '1.0',
      policy: {
        mode: 'block',
        default_action: 'pass',
        rules: [
          {
            name: 'rate-db',
            action: 'block',
            tools: { allow: ['query_db'] },
            maxCallsPerMinute: 2,
          },
        ],
      },
    };
    const engine = new PolicyEngine(config);
    const harmless = engine.evaluate(ctx('harmless_tool'));
    expect(harmless.action).toBe('pass');

    engine.resetRateCounters();
    expect(engine.evaluate(ctx('query_db')).action).toBe('pass');
    expect(engine.evaluate(ctx('query_db')).action).toBe('pass');
    const blocked = engine.evaluate(ctx('query_db'));
    expect(blocked.action).toBe('block');
    expect(blocked.rule).toBe('rate-db');
  });

  it('honors enforceAllowlist for explicit global deny per rule', () => {
    const config: PolicyConfig = {
      version: '1.0',
      policy: {
        mode: 'block',
        default_action: 'pass',
        rules: [
          {
            name: 'strict-allow',
            action: 'block',
            tools: { allow: ['search'], enforceAllowlist: true },
          },
        ],
      },
    };
    const engine = new PolicyEngine(config);
    const blocked = engine.evaluate(ctx('bash'));
    expect(blocked.action).toBe('block');
    expect(blocked.rule).toBe('strict-allow');
  });
});
