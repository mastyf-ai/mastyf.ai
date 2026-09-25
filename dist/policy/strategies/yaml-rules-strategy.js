import { evaluateEncodingGuard } from '../encoding-guard.js';
import { scanToolCallArguments } from '../../scanners/prompt-injection-detector.js';
import { runTokenInspection } from '../../scanners/token-inspector.js';
import { walkStringLeaves } from '../arg-leaf-walker.js';
/** Defense in depth: allowlisted tools must still pass argument guards (adv-066 class). */
function blockAllowlistedToolIfArgsUnsafe(ctx) {
    const encoding = evaluateEncodingGuard(ctx);
    if (encoding)
        return encoding;
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
    // Layer 4: JWT/SAML token inspection (fixes 87% token evasion)
    const flat = walkStringLeaves(ctx.arguments ?? {}).map((l) => ({ keyPath: '(root)', value: l.value }));
    const tokenIssues = runTokenInspection(flat);
    if (tokenIssues.length > 0) {
        const top = tokenIssues[0];
        return {
            action: 'block',
            rule: 'token-inspection',
            reason: top.message ?? 'Allowlisted tool blocked: suspicious token/JWT detected',
        };
    }
    return null;
}
export const yamlRulesStrategy = {
    name: 'yaml-rules',
    evaluate({ raw, normalized, argsStr, skipLocalRateLimit }, deps) {
        let permittedByAllowlist = false;
        for (const rule of deps.rules) {
            if (rule.enabled === false)
                continue;
            if (rule.tools?.allow?.length && rule.tools.allow.includes(normalized.toolName)) {
                permittedByAllowlist = true;
            }
            const decision = deps.evaluateRule(rule, normalized, { argsStr, raw }, skipLocalRateLimit);
            if (decision)
                return decision;
        }
        if (permittedByAllowlist) {
            const unsafe = blockAllowlistedToolIfArgsUnsafe(raw);
            if (unsafe)
                return unsafe;
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
//# sourceMappingURL=yaml-rules-strategy.js.map