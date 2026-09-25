import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import { parsePolicyConfig } from './policy-schema.js';
import { Logger } from '../utils/logger.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const HTTP_TOOLS_TEMPLATE_CANDIDATES = [
    resolve(process.cwd(), 'policy-templates', 'http-tools-policy.yaml'),
    resolve(__dirname, '..', '..', 'policy-templates', 'http-tools-policy.yaml'),
    resolve(__dirname, '..', 'policy-templates', 'http-tools-policy.yaml'),
];
export function resolveHttpToolsPolicyPath() {
    const explicit = process.env['MASTYF_AI_HTTP_TOOLS_POLICY_PATH'];
    if (explicit && existsSync(explicit))
        return explicit;
    for (const p of HTTP_TOOLS_TEMPLATE_CANDIDATES) {
        if (existsSync(p))
            return p;
    }
    return null;
}
export function isHttpToolsPolicyMergeEnabled() {
    return process.env['MASTYF_AI_HTTP_TOOLS_POLICY'] === 'true';
}
function dedupeRules(rules) {
    const seen = new Set();
    const out = [];
    for (const r of rules) {
        if (seen.has(r.name))
            continue;
        seen.add(r.name);
        out.push(r);
    }
    return out;
}
/** Append HTTP tools SSRF rules from template when MASTYF_AI_HTTP_TOOLS_POLICY=true. */
export function mergeHttpToolsPolicy(base) {
    if (!isHttpToolsPolicyMergeEnabled())
        return base;
    const templatePath = resolveHttpToolsPolicyPath();
    if (!templatePath) {
        Logger.warn('[policy-merge] MASTYF_AI_HTTP_TOOLS_POLICY=true but http-tools-policy.yaml not found');
        return base;
    }
    try {
        const overlay = parsePolicyConfig(load(readFileSync(templatePath, 'utf-8')));
        const overlayRules = overlay?.policy?.rules ?? [];
        if (overlayRules.length === 0)
            return base;
        const merged = {
            ...base,
            policy: {
                ...base.policy,
                rules: dedupeRules([...base.policy.rules, ...overlayRules]),
            },
        };
        Logger.info(`[policy-merge] Merged ${overlayRules.length} HTTP tools rule(s) from ${templatePath}`);
        return merged;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.warn(`[policy-merge] Failed to merge HTTP tools policy: ${message}`);
        return base;
    }
}
export function applyPolicyMerges(raw) {
    return mergeHttpToolsPolicy(raw);
}
//# sourceMappingURL=policy-merge.js.map