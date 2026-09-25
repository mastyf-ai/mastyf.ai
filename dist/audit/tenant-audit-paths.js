/**
 * Per-tenant audit file paths under ~/.mastyf-ai/tenants/{tenantId}/
 */
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { validateTenantId, DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
export function mastyfAiHomeDir() {
    return process.env['MASTYF_AI_HOME'] || join(homedir(), '.mastyf-ai');
}
export function resolveTenantAuditDir(tenantId) {
    const tid = validateTenantId(tenantId || process.env['MASTYF_AI_TENANT_ID'] || DEFAULT_TENANT_ID);
    return join(mastyfAiHomeDir(), 'tenants', tid);
}
export function ensureTenantAuditDir(tenantId) {
    const dir = resolveTenantAuditDir(tenantId);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
export function resolveTenantPolicyAuditJsonl(tenantId) {
    return join(ensureTenantAuditDir(tenantId), 'policy-audit.jsonl');
}
export function resolveTenantAccessLogJsonl(tenantId) {
    return join(ensureTenantAuditDir(tenantId), 'dashboard-access.jsonl');
}
export function resolveTenantSessionAuditJsonl(tenantId) {
    return join(ensureTenantAuditDir(tenantId), 'session-audit.jsonl');
}
//# sourceMappingURL=tenant-audit-paths.js.map