import { describe, it, expect } from 'vitest';
import { parsePolicyConfig, PolicySchema } from '../../src/policy/policy-schema.js';

describe('parsePolicyConfig', () => {
  it('accepts full rule shape used by policy engine', () => {
    const config = parsePolicyConfig({
      version: '1.0',
      policy: {
        mode: 'block',
        default_action: 'pass',
        semantic_shell: true,
        unicode_strict: true,
        rules: [
          {
            name: 'deny-shell',
            description: 'Block shell tools',
            action: 'block',
            tools: { deny: ['bash', 'sh'] },
            patterns: ['rm\\s+-rf'],
            argPatterns: [{ field: 'command', patterns: ['curl\\s'] }],
            toolCategories: { deny: ['shell'] },
            toolAllowExceptions: ['safe_run'],
            maxTokens: 1000,
            maxCallsPerMinute: 60,
            rbac: { scopes: ['mcp:read'], clientIds: ['agent-1'] },
          },
        ],
      },
    });
    expect(config.policy.rules[0].argPatterns?.[0].field).toBe('command');
    expect(config.policy.semantic_shell).toBe(true);
    expect(config.policy.unicode_strict).toBe(true);
  });

  it('rejects invalid mode', () => {
    expect(() =>
      PolicySchema.parse({ version: '1.0', policy: { mode: 'invalid', rules: [] } }),
    ).toThrow();
  });

  it('rejects excessively nested policy YAML', () => {
    let nested: Record<string, unknown> = { action: 'block', name: 'leaf' };
    for (let i = 0; i < 25; i++) {
      nested = { rules: [nested] };
    }
    expect(() =>
      parsePolicyConfig({
        version: '1.0',
        policy: { mode: 'block', rules: [nested] },
      }),
    ).toThrow(/max nesting depth/i);
  });
});
