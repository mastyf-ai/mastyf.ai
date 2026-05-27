import { createHash } from 'node:crypto';
import type { PolicyConfig } from '../policy/policy-types.js';

export const COMPILED_RULES_SCHEMA_VERSION = 'v1';

export interface CompiledRules {
  schemaVersion: string;
  generatedAt: string;
  sourcePolicyVersion: string;
  minProxyVersion: string;
  blockedTools: string[];
  allowedTools: string[];
  blockedMethodSubstrings: string[];
  policyMode: PolicyConfig['policy']['mode'];
  defaultAction: NonNullable<PolicyConfig['policy']['default_action']> | 'pass';
}

export interface DecisionTelemetryEvent {
  schemaVersion: string;
  timestamp: string;
  requestId: string;
  toolName: string;
  action: 'pass' | 'block' | 'flag';
  reason: string;
  source: 'data-plane';
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((v) => v.trim()).filter(Boolean))].sort();
}

export function compilePolicyToRules(config: PolicyConfig): CompiledRules {
  const blockedTools = new Set<string>();
  const allowedTools = new Set<string>();
  const blockedMethodSubstrings = new Set<string>();

  for (const rule of config.policy.rules) {
    if (rule.tools?.deny?.length) {
      for (const item of rule.tools.deny) blockedTools.add(item);
    }
    if (rule.tools?.allow?.length) {
      for (const item of rule.tools.allow) allowedTools.add(item);
    }
    if (rule.toolCategories?.deny?.length) {
      for (const item of rule.toolCategories.deny) blockedMethodSubstrings.add(item);
    }
  }

  return {
    schemaVersion: COMPILED_RULES_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourcePolicyVersion: config.version,
    minProxyVersion: '0.1.0',
    blockedTools: uniqueSorted(blockedTools),
    allowedTools: uniqueSorted(allowedTools),
    blockedMethodSubstrings: uniqueSorted(blockedMethodSubstrings),
    policyMode: config.policy.mode,
    defaultAction: config.policy.default_action ?? 'pass',
  };
}

export function compiledRulesEtag(rules: CompiledRules): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(rules))
    .digest('hex');
  return `W/"${hash}"`;
}
