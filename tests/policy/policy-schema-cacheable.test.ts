import { describe, expect, it } from 'vitest';
import { parsePolicyConfig } from '../../src/policy/policy-schema.js';

describe('policy schema cacheable', () => {
  it('preserves cacheable on rules when parsing YAML-shaped config', () => {
    const cfg = parsePolicyConfig({
      version: '1',
      policy: {
        mode: 'block',
        rules: [
          {
            name: 'static-allow',
            action: 'pass',
            cacheable: true,
            tools: { allow: ['read_file'] },
          },
        ],
      },
    });
    expect(cfg.policy.rules[0]?.cacheable).toBe(true);
  });
});
