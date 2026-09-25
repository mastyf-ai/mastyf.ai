let cachedMap = null;
function loadTenantSemanticMap() {
    if (cachedMap)
        return cachedMap;
    cachedMap = new Map();
    const raw = process.env['MASTYF_AI_TENANT_SEMANTIC_JSON'];
    if (!raw?.trim())
        return cachedMap;
    try {
        const obj = JSON.parse(raw);
        for (const [tenant, cfg] of Object.entries(obj)) {
            if (cfg && typeof cfg === 'object')
                cachedMap.set(tenant, cfg);
        }
    }
    catch {
        cachedMap = new Map();
    }
    return cachedMap;
}
/** @internal */
export function resetTenantSemanticConfigForTests() {
    cachedMap = null;
    delete process.env.MASTYF_AI_TENANT_SEMANTIC_JSON;
}
export function getTenantSemanticOverrides(tenantId) {
    if (!tenantId)
        return undefined;
    return loadTenantSemanticMap().get(tenantId);
}
export function isLocalSemanticEnabledForTenant(tenantId) {
    const o = getTenantSemanticOverrides(tenantId);
    if (o?.localSemantic !== undefined)
        return o.localSemantic;
    return isLocalSemanticEnabledGlobal();
}
export function isLocalSemanticEnabledGlobal() {
    if (process.env['MASTYF_AI_LOCAL_SEMANTIC'] === 'false')
        return false;
    if (process.env['MASTYF_AI_LOCAL_SEMANTIC'] === 'true')
        return true;
    return process.env['MASTYF_AI_DISABLE_SEMANTIC'] !== 'true';
}
/** Global sync-response gate — production defaults on unless explicitly disabled. */
export function isSyncSemanticResponseEnabledGlobal() {
    const explicit = process.env['MASTYF_AI_SEMANTIC_SYNC_RESPONSE'];
    if (explicit === 'true')
        return true;
    if (explicit === 'false')
        return false;
    return process.env.NODE_ENV === 'production';
}
export function isSyncSemanticResponseEnabledForTenant(tenantId) {
    const o = getTenantSemanticOverrides(tenantId);
    if (o?.syncResponse !== undefined)
        return o.syncResponse;
    return isSyncSemanticResponseEnabledGlobal();
}
export function isSyncSemanticLlmEnabledForTenant(tenantId) {
    const o = getTenantSemanticOverrides(tenantId);
    if (o?.syncResponseLlm !== undefined)
        return o.syncResponseLlm;
    return (isSyncSemanticResponseEnabledForTenant(tenantId)
        && process.env['MASTYF_AI_SEMANTIC_SYNC_RESPONSE_LLM'] === 'true');
}
export function isSemanticAsyncEnabledForTenant(tenantId) {
    const o = getTenantSemanticOverrides(tenantId);
    if (o?.asyncAudit !== undefined)
        return o.asyncAudit;
    if (process.env['MASTYF_AI_SEMANTIC_ASYNC'] === 'false')
        return false;
    if (process.env['MASTYF_AI_SEMANTIC_ASYNC'] === 'true')
        return true;
    return process.env['MASTYF_AI_LLM_ENABLED'] !== 'false';
}
export function isSemanticStrictForTenant(tenantId) {
    const o = getTenantSemanticOverrides(tenantId);
    if (o?.strict !== undefined)
        return o.strict;
    return process.env['MASTYF_AI_SEMANTIC_STRICT'] === 'true';
}
export function isEnterpriseMode() {
    return process.env['MASTYF_AI_ENTERPRISE_MODE'] === 'true';
}
/** Sync request gate — ON by default in enterprise when LLM is available. */
export function isSyncSemanticRequestEnabledGlobal() {
    const explicit = process.env['MASTYF_AI_SEMANTIC_SYNC_REQUEST'];
    if (explicit === 'true')
        return true;
    if (explicit === 'false')
        return false;
    return isEnterpriseMode();
}
export function isSyncSemanticRequestEnabledForTenant(tenantId) {
    const o = getTenantSemanticOverrides(tenantId);
    if (o?.syncRequest !== undefined)
        return o.syncRequest;
    return isSyncSemanticRequestEnabledGlobal();
}
export function isSyncSemanticRequestLlmEnabledForTenant(tenantId) {
    const o = getTenantSemanticOverrides(tenantId);
    if (o?.syncRequestLlm !== undefined)
        return o.syncRequestLlm;
    if (process.env['MASTYF_AI_SEMANTIC_SYNC_REQUEST_LLM'] === 'false')
        return false;
    if (process.env['MASTYF_AI_SEMANTIC_SYNC_REQUEST_LLM'] === 'true')
        return true;
    return isSyncSemanticRequestEnabledForTenant(tenantId) && isEnterpriseMode();
}
//# sourceMappingURL=tenant-semantic-config.js.map