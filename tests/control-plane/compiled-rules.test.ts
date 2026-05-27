import { describe, expect, it } from 'vitest';
import { compilePolicyToRules, COMPILED_RULES_SCHEMA_VERSION } from '../../src/control-plane/compiled-rules.js';
import type { PolicyConfig } from '../../src/policy/policy-types.js';

describe('compilePolicyToRules', () => {
  it('compiles a policy into a normalized rules payload', () => {
    const config: PolicyConfig = {
      version: '3.2.8',
      policy: {
        mode: 'block',
        default_action: 'block',
        rules: [
          {
            name: 'deny-dangerous-tools',
            action: 'block',
            tools: { deny: ['delete_database', 'exfiltrate_keys'] },
            toolCategories: { deny: ['delete', 'drop'] },
          },
          {
            name: 'allow-safe-tools',
            action: 'pass',
            tools: { allow: ['read_file', 'list_directory'] },
          },
        ],
      },
    };

    const compiled = compilePolicyToRules(config);
    expect(compiled.schemaVersion).toBe(COMPILED_RULES_SCHEMA_VERSION);
    expect(compiled.sourcePolicyVersion).toBe('3.2.8');
    expect(compiled.policyMode).toBe('block');
    expect(compiled.defaultAction).toBe('block');
    expect(compiled.blockedTools).toEqual(['delete_database', 'exfiltrate_keys']);
    expect(compiled.allowedTools).toEqual(['list_directory', 'read_file']);
    expect(compiled.blockedMethodSubstrings).toEqual(['delete', 'drop']);
  });
});
