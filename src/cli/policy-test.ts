import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { PolicyEngine } from '../policy/policy-engine.js';
import type { CallContext, PolicyConfig } from '../policy/policy-types.js';

import type { PolicyTestOptions } from './policy-test-request.js';

export { policyTestRequest, type PolicyTestOptions } from './policy-test-request.js';

export interface PolicyTestResult {
  action: string;
  rule: string;
  reason: string;
  mode: string;
  /** Time spent deciding, excluding loading the policy file and building the engine. */
  elapsedMs?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function runPolicyTest(opts: PolicyTestOptions): PolicyTestResult {
  const raw = readFileSync(opts.policy, 'utf-8');
  const config = load(raw) as PolicyConfig;
  if (opts.blockingMode && ['audit', 'warn', 'block'].includes(opts.blockingMode)) {
    config.policy.mode = opts.blockingMode as PolicyConfig['policy']['mode'];
  }

  let args: Record<string, unknown> = {};
  if (opts.args) {
    args = JSON.parse(opts.args) as Record<string, unknown>;
  }

  const engine = new PolicyEngine(config);
  const context: CallContext = {
    serverName: opts.server || 'policy-test',
    toolName: opts.tool,
    arguments: args,
    requestId: `policy-test-${Date.now()}`,
    requestTokens: 100,
    timestamp: new Date().toISOString(),
    dryRun: opts.dryRun === true,
  };

  const started = performance.now();
  const decision = engine.evaluate(context);
  const elapsedMs = round2(performance.now() - started);
  return {
    action: decision.action,
    rule: decision.rule,
    reason: decision.reason,
    mode: engine.getMode(),
    elapsedMs,
  };
}

/**
 * Check a tool result against the policy: the response gate the proxy runs on every answer a
 * server sends back (data-leak scanning, injected instructions, and semantic review when enabled).
 */
export async function runPolicyResultTest(opts: PolicyTestOptions & { result: string }): Promise<PolicyTestResult> {
  const raw = readFileSync(opts.policy, 'utf-8');
  const config = load(raw) as PolicyConfig;
  if (opts.blockingMode && ['audit', 'warn', 'block'].includes(opts.blockingMode)) {
    config.policy.mode = opts.blockingMode as PolicyConfig['policy']['mode'];
  }
  const engine = new PolicyEngine(config);
  const { gateToolResponseText } = await import('../utils/response-security-gate.js');
  const started = performance.now();
  const gate = await gateToolResponseText({
    responseText: opts.result,
    toolName: opts.tool,
    serverName: opts.server || 'policy-test',
    policy: engine,
  });
  const elapsedMs = round2(performance.now() - started);
  const outcome = gate.outcome;
  if (outcome.action === 'block') {
    return { action: 'block', rule: outcome.rule, reason: outcome.message.replace(/^Mastyf AI:\s*/, ''), mode: engine.getMode(), elapsedMs };
  }
  if (outcome.action === 'redact') {
    return {
      action: 'redact',
      rule: 'response-dlp',
      reason: `Sensitive data would be redacted: ${(outcome.redactionReasons ?? []).slice(0, 3).join('; ') || 'data-leak pattern'}`,
      mode: engine.getMode(),
      elapsedMs,
    };
  }
  const findings = gate.inspect?.findings?.length ?? 0;
  return {
    action: 'allow',
    rule: 'default',
    reason: findings > 0 ? `Passed with ${findings} low-severity finding(s)` : 'No rule matched this result',
    mode: engine.getMode(),
    elapsedMs,
  };
}
