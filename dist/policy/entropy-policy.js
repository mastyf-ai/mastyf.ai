const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT_SHAPE = /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
let activeEntropyPolicy = null;
export function setActiveEntropyPolicy(config) {
    const raw = config?.policy?.entropy;
    activeEntropyPolicy = raw ?? null;
}
function builtInSafeMatch(value, pattern) {
    if (pattern === 'uuid-v4' || pattern === 'uuid')
        return UUID_V4.test(value);
    if (pattern === 'jwt')
        return JWT_SHAPE.test(value);
    return false;
}
export function isEntropySafeValue(value, toolName, fieldName) {
    const policy = activeEntropyPolicy;
    const patterns = new Set(policy?.safe_patterns ?? []);
    if (toolName && fieldName && policy?.tools?.[toolName]?.fields?.[fieldName]?.allow_patterns) {
        for (const p of policy.tools[toolName].fields[fieldName].allow_patterns) {
            patterns.add(p);
        }
    }
    for (const p of patterns) {
        if (builtInSafeMatch(value, p))
            return true;
        try {
            if (new RegExp(p).test(value))
                return true;
        }
        catch {
            /* invalid regex in policy — skip */
        }
    }
    return false;
}
export function minEntropyForContext(toolName, fieldName) {
    const policy = activeEntropyPolicy;
    if (toolName && fieldName) {
        const field = policy?.tools?.[toolName]?.fields?.[fieldName];
        if (field?.min_entropy !== undefined)
            return field.min_entropy;
    }
    return policy?.default_min;
}
//# sourceMappingURL=entropy-policy.js.map