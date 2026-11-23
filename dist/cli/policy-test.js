import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { PolicyEngine } from '../policy/policy-engine.js';
export { policyTestRequest } from './policy-test-request.js';
const round2 = (n) => Math.round(n * 100) / 100;
export function runPolicyTest(opts) {
    const raw = readFileSync(opts.policy, 'utf-8');
    const config = load(raw);
    if (opts.blockingMode && ['audit', 'warn', 'block'].includes(opts.blockingMode)) {
        config.policy.mode = opts.blockingMode;
    }
    let args = {};
    if (opts.args) {
        args = JSON.parse(opts.args);
    }
    const engine = new PolicyEngine(config);
    const context = {
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
export async function runPolicyResultTest(opts) {
    const raw = readFileSync(opts.policy, 'utf-8');
    const config = load(raw);
    if (opts.blockingMode && ['audit', 'warn', 'block'].includes(opts.blockingMode)) {
        config.policy.mode = opts.blockingMode;
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
//# sourceMappingURL=policy-test.js.map