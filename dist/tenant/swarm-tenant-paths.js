/**
 * Per-tenant security-swarm artifact directories.
 * Legacy global path: reports/security-swarm (default tenant reads when present).
 */
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_TENANT_ID, validateTenantId } from './resolve-tenant.js';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LEGACY_SWARM_DIR = join(REPO_ROOT, 'reports', 'security-swarm');
/** Output dir for swarm / Threat Lab / auto-research (dashboard sets MASTYF_AI_SWARM_DIR). */
export function resolveSwarmOutputDir() {
    const override = process.env.MASTYF_AI_SWARM_DIR?.trim();
    return override || LEGACY_SWARM_DIR;
}
/** Writable/read path for a tenant's swarm artifacts. */
export function resolveTenantSwarmDir(tenantId) {
    const tid = validateTenantId(tenantId);
    return join(REPO_ROOT, 'reports', 'tenants', tid, 'security-swarm');
}
/** Resolve dir for reads: tenant dir only (no committed legacy artifacts unless opted in). */
export function getEffectiveSwarmDir(tenantId) {
    const tid = validateTenantId(tenantId);
    const tenantDir = resolveTenantSwarmDir(tid);
    const hasTenantArtifacts = existsSync(join(tenantDir, 'job.json'))
        || existsSync(join(tenantDir, 'threat-lab-job.json'))
        || existsSync(join(tenantDir, 'auto-research-job.json'))
        || existsSync(join(tenantDir, 'threat-lab-candidates.json'))
        || existsSync(join(tenantDir, 'auto-corpus-manifest.json'))
        || existsSync(join(tenantDir, 'latest.json'))
        || existsSync(join(tenantDir, 'visuals-data.json'))
        || existsSync(join(tenantDir, 'report.json'));
    if (hasTenantArtifacts)
        return tenantDir;
    if (tid === DEFAULT_TENANT_ID
        && process.env.MASTYF_AI_SWARM_USE_LEGACY_ARTIFACTS === 'true') {
        const hasLegacy = existsSync(join(LEGACY_SWARM_DIR, 'job.json'))
            || existsSync(join(LEGACY_SWARM_DIR, 'latest.json'))
            || existsSync(join(LEGACY_SWARM_DIR, 'visuals-data.json'));
        if (hasLegacy)
            return LEGACY_SWARM_DIR;
    }
    return tenantDir;
}
export function resolveTenantPolicyAuditPath(tenantId) {
    const tid = validateTenantId(tenantId);
    return join(REPO_ROOT, 'reports', 'tenants', tid, 'policy-audit.jsonl');
}
export { REPO_ROOT };
//# sourceMappingURL=swarm-tenant-paths.js.map