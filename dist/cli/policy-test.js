import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { PolicyEngine } from '../policy/policy-engine.js';
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
    };
    const decision = engine.evaluate(context);
    return {
        action: decision.action,
        rule: decision.rule,
        reason: decision.reason,
        mode: engine.getMode(),
    };
}
//# sourceMappingURL=policy-test.js.map