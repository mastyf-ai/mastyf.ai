import type { PolicyDecision } from '../policy-types.js';
import { evaluateEncodingGuard } from '../encoding-guard.js';
import { scanToolCallArguments } from '../../scanners/prompt-injection-detector.js';
import { scanForSecrets } from '../../scanners/secret-scanner.js';
import { runArgumentScan } from '@mcp-guardian/core';
import type { PolicyStrategy } from './types.js';

/** Defense in depth: allowlisted tools must still pass argument guards (adv-066 class). */
function blockAllowlistedToolIfArgsUnsafe(ctx: import('../policy-types.js').CallContext): PolicyDecision | null {
  const encoding = evaluateEncodingGuard(ctx);
  if (encoding) return encoding;

  // Layer 1: prompt injection + instruction override detection
  const findings = scanToolCallArguments(ctx.arguments ?? {});
  if (findings.length > 0) {
    const top = findings[0];
    return {
      action: 'block',
      rule: top.patternId ?? 'request-prompt-injection',
      reason: top.description ?? 'Allowlisted tool blocked: unsafe arguments',
    };
  }

  // Layer 2: comprehensive argument scanner (SQL/NoSQL, boundary, shell, etc.)
  const argResult = runArgumentScan(ctx.arguments ?? {}, ctx.toolName ?? 'unknown');
  if (argResult.issues.length > 0) {
    const top = argResult.issues[0];
    return {
      action: 'block',
      rule: top.id ?? 'argument-scan',
      reason: top.message ?? 'Allowlisted tool blocked: unsafe arguments detected',
    };
  }

  // Layer 3: credential/secret detection in args
  const argsStr = JSON.stringify(ctx.arguments ?? {});
  const secrets = scanForSecrets(argsStr, ctx.toolName ?? 'unknown');
  if (secrets.length > 0) {
    return {
      action: 'block',
      rule: 'secret-in-args',
      reason: 'Allowlisted tool blocked: credentials/secrets detected in arguments',
    };
  }

  return null;
}

export const yamlRulesStrategy: PolicyStrategy = {
  name: 'yaml-rules',
  evaluate({ raw, normalized, argsStr, skipLocalRateLimit }, deps) {
    let permittedByAllowlist = false;
    for (const rule of deps.rules) {
      if (rule.tools?.allow?.length && rule.tools.allow.includes(normalized.toolName)) {
        permittedByAllowlist = true;
      }
      const decision = deps.evaluateRule(
        rule,
        normalized,
        { argsStr, raw },
        skipLocalRateLimit,
      );
      if (decision) return decision;
    }

    if (permittedByAllowlist) {
      const unsafe = blockAllowlistedToolIfArgsUnsafe(raw);
      if (unsafe) return unsafe;
      return {
        action: 'pass',
        rule: 'allowlist',
        reason: `Tool '${normalized.toolName}' is allowlisted and passed policy checks`,
      };
    }

    const defaultAction = deps.config.policy.default_action ?? 'pass';
    return {
      action: deps.resolveAction(defaultAction),
      rule: 'default',
      reason: `No matching rule — applying default_action: ${defaultAction}`,
    };
  },
};
