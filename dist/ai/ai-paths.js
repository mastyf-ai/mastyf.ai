import { join } from 'path';
import { DEFAULT_TENANT_ID, resolveTenantId } from '../tenant/resolve-tenant.js';
import { mastyfAiHomeDir } from '../audit/tenant-audit-paths.js';
function tenantDataDir(tenantId) {
    const tid = tenantId || resolveTenantId();
    const base = mastyfAiHomeDir();
    if (tid === DEFAULT_TENANT_ID) {
        return base;
    }
    return join(base, 'tenants', tid);
}
function resolveTenantScopedPath(envKey, filename, tenantId) {
    const tid = tenantId || resolveTenantId();
    const envPath = process.env[envKey];
    if (envPath && tid === DEFAULT_TENANT_ID) {
        return envPath;
    }
    return join(tenantDataDir(tid), filename);
}
export function resolveAiLearningStatePath(tenantId) {
    return resolveTenantScopedPath('MASTYF_AI_AI_STATE_PATH', '.ai-learning.json', tenantId);
}
export function resolveAiPendingSuggestionsPath(tenantId) {
    return resolveTenantScopedPath('MASTYF_AI_AI_SUGGESTIONS_PATH', '.ai-pending-suggestions.json', tenantId);
}
export function resolveAiReportPath(tenantId) {
    return resolveTenantScopedPath('MASTYF_AI_AI_REPORT_PATH', '.ai-report.json', tenantId);
}
export function resolveAiBaselinesPath(tenantId) {
    return resolveTenantScopedPath('MASTYF_AI_AI_BASELINES_PATH', '.ai-baselines.json', tenantId);
}
export function resolveAttackLearningStatePath(tenantId) {
    return resolveTenantScopedPath('MASTYF_AI_AI_ATTACK_STATE_PATH', '.attack-learning-state.json', tenantId);
}
export function resolveThreatStatePath(tenantId) {
    return resolveTenantScopedPath('MASTYF_AI_THREAT_STATE_PATH', '.threat-state.json', tenantId);
}
//# sourceMappingURL=ai-paths.js.map