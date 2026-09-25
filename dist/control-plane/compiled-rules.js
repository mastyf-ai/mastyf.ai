import { createHash } from 'node:crypto';
export const COMPILED_RULES_SCHEMA_VERSION = 'v2';
function uniqueSorted(values) {
    return [...new Set([...values].map((v) => v.trim()).filter(Boolean))].sort();
}
function tokensPerMinuteCapFromPolicy(config) {
    let max = 0;
    for (const rule of config.policy.rules) {
        if (rule.maxTokensPerMinute && rule.maxTokensPerMinute > max) {
            max = rule.maxTokensPerMinute;
        }
    }
    const env = parseInt(process.env['MASTYF_AI_TENANT_TOKENS_PER_MIN'] || '', 10);
    if (Number.isFinite(env) && env > 0)
        return env;
    return max > 0 ? max : 500_000;
}
function usdPerMinuteCapFromPolicy(config) {
    let max = 0;
    for (const rule of config.policy.rules) {
        if (rule.maxUsdPerMinute && rule.maxUsdPerMinute > max) {
            max = rule.maxUsdPerMinute;
        }
    }
    const env = parseFloat(process.env['MASTYF_AI_TENANT_USD_PER_MIN'] || '');
    if (Number.isFinite(env) && env > 0)
        return env;
    return max > 0 ? max : 50;
}
export function compilePolicyToRules(config) {
    const blockedTools = new Set();
    const allowedTools = new Set();
    const blockedMethodSubstrings = new Set();
    for (const rule of config.policy.rules) {
        if (rule.tools?.deny?.length) {
            for (const item of rule.tools.deny)
                blockedTools.add(item);
        }
        if (rule.tools?.allow?.length) {
            for (const item of rule.tools.allow)
                allowedTools.add(item);
        }
        if (rule.toolCategories?.deny?.length) {
            for (const item of rule.toolCategories.deny)
                blockedMethodSubstrings.add(item);
        }
    }
    return {
        schemaVersion: 'v2',
        generatedAt: new Date().toISOString(),
        sourcePolicyVersion: config.version,
        minProxyVersion: '0.2.0',
        blockedTools: uniqueSorted(blockedTools),
        allowedTools: uniqueSorted(allowedTools),
        blockedMethodSubstrings: uniqueSorted(blockedMethodSubstrings),
        policyMode: config.policy.mode,
        defaultAction: config.policy.default_action ?? 'pass',
        tokensPerMinuteCap: tokensPerMinuteCapFromPolicy(config),
        usdPerMinuteCap: usdPerMinuteCapFromPolicy(config),
    };
}
export function compiledRulesEtag(rules) {
    const hash = createHash('sha256')
        .update(JSON.stringify(rules))
        .digest('hex');
    return `W/"${hash}"`;
}
//# sourceMappingURL=compiled-rules.js.map