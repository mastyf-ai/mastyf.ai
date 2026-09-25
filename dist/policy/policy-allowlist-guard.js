import { StructuredLogger } from '../utils/structured-logger.js';
export function isStrictAllowlistRbac() {
    if (process.env['MASTYF_AI_STRICT_ALLOWLIST_RBAC'] === 'true')
        return true;
    if (process.env['MASTYF_AI_STRICT_ALLOWLIST_RBAC'] === 'false')
        return false;
    return process.env['MASTYF_AI_ENTERPRISE_MODE'] === 'true';
}
export function validateAllowlistRbac(config) {
    const strict = isStrictAllowlistRbac();
    for (const rule of config.policy.rules) {
        const hasAllow = rule.tools?.allow && rule.tools.allow.length > 0;
        if (!hasAllow)
            continue;
        const hasRbac = (rule.rbac?.clientIds && rule.rbac.clientIds.length > 0) ||
            (rule.rbac?.scopes && rule.rbac.scopes.length > 0);
        if (!hasRbac) {
            const msg = `Rule '${rule.name}' grants tools.allow without rbac.clientIds or rbac.scopes — any authenticated agent can use these tools`;
            if (strict) {
                throw new Error(`${msg}. Set MASTYF_AI_STRICT_ALLOWLIST_RBAC=false to allow, or add rbac to the rule.`);
            }
            StructuredLogger.warn({ event: 'policy_allowlist_no_rbac', rule: rule.name, message: msg });
        }
    }
}
//# sourceMappingURL=policy-allowlist-guard.js.map