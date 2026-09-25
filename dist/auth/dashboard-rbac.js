/**
 * Dashboard RBAC — role claims from JWT session payload or API key metadata.
 *
 * Roles: viewer, analyst, operator, admin, tenant-admin
 * Env: MASTYF_AI_DASHBOARD_ROLES — `api_key_prefix:role,...` or JSON `{"<apiKey>":"admin"}`
 * JWT session payload may include `roles: string[]` or `role: string`.
 */
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
export const DASHBOARD_ROLE_ORDER = [
    'viewer',
    'analyst',
    'operator',
    'admin',
    'tenant-admin',
];
const ALL_ROLES = new Set(DASHBOARD_ROLE_ORDER);
export function normalizeDashboardRole(raw) {
    const r = raw.trim().toLowerCase().replace(/_/g, '-');
    if (r === 'tenantadmin')
        return 'tenant-admin';
    return ALL_ROLES.has(r) ? r : null;
}
/** Parse MASTYF_AI_DASHBOARD_ROLES env (comma map or JSON object). */
export function parseDashboardRolesEnv(raw) {
    const map = new Map();
    const env = raw ?? process.env['MASTYF_AI_DASHBOARD_ROLES'];
    if (!env?.trim())
        return map;
    const trimmed = env.trim();
    if (trimmed.startsWith('{')) {
        try {
            const obj = JSON.parse(trimmed);
            for (const [key, val] of Object.entries(obj)) {
                const role = normalizeDashboardRole(val);
                if (role)
                    map.set(key, role);
            }
        }
        catch {
            /* ignore malformed JSON */
        }
        return map;
    }
    for (const part of trimmed.split(',')) {
        const eq = part.indexOf(':');
        if (eq <= 0)
            continue;
        const key = part.slice(0, eq).trim();
        const role = normalizeDashboardRole(part.slice(eq + 1));
        if (key && role)
            map.set(key, role);
    }
    return map;
}
export function roleRank(role) {
    return DASHBOARD_ROLE_ORDER.indexOf(role);
}
export function hasAtLeastRole(actual, required) {
    if (actual === 'tenant-admin' && required !== 'tenant-admin') {
        return roleRank('admin') >= roleRank(required);
    }
    if (required === 'tenant-admin') {
        return actual === 'tenant-admin' || actual === 'admin';
    }
    return roleRank(actual) >= roleRank(required);
}
/** Minimum role for each permission tier. */
const PERMISSION_MIN_ROLE = {
    read: 'viewer',
    export: 'analyst',
    policy_test: 'operator',
    policy_mutate: 'operator',
    admin: 'admin',
    ai: 'admin',
};
export function permissionForRoute(method, url) {
    const path = url.split('?')[0] || '/';
    const m = method.toUpperCase();
    if (path === '/metrics' || path.startsWith('/api/aggregate/')) {
        return m === 'GET' ? (path.includes('audit') && url.includes('export=1') ? 'export' : 'read') : null;
    }
    if (path === '/api/security' ||
        path === '/api/cost' ||
        path === '/api/health' ||
        path === '/api/instances' ||
        path === '/api/auth/status') {
        return m === 'GET' ? 'read' : null;
    }
    if (path === '/api/logs' || path.startsWith('/api/logs/')) {
        if (m === 'GET')
            return 'read';
        if (m === 'POST' || m === 'PUT')
            return 'admin';
        return null;
    }
    if (path === '/api/policy/test')
        return m === 'POST' ? 'policy_test' : null;
    if (path === '/api/policy/copilot')
        return m === 'POST' ? 'policy_test' : null;
    if (path === '/api/policy/copilot/replay')
        return m === 'POST' ? 'policy_test' : null;
    if (path === '/api/policy/copilot/counterfactual')
        return m === 'POST' ? 'policy_test' : null;
    if (path === '/api/incidents/investigate')
        return m === 'POST' ? 'ai' : null;
    if (path === '/api/learning/semantic/active-learning')
        return m === 'GET' ? 'ai' : null;
    if (path === '/api/learning/semantic/tribunal' || path === '/api/learning/semantic/tribunal/run') {
        return m === 'GET' || m === 'POST' ? 'ai' : null;
    }
    if (path.startsWith('/api/dashboard/insights'))
        return m === 'GET' ? 'read' : null;
    if (path === '/api/dashboard/agent-abuse')
        return m === 'GET' ? 'read' : null;
    if (path === '/api/security-swarm/tool-integrity')
        return m === 'GET' ? 'read' : null;
    if (path === '/api/security-swarm/shadow-red-team')
        return m === 'GET' ? 'read' : null;
    if (path === '/api/security-swarm/supply-chain')
        return m === 'GET' ? 'read' : null;
    if (path === '/api/fleet/signature-hints')
        return m === 'GET' ? 'read' : null;
    if (path === '/api/ai/compliance/report')
        return m === 'GET' ? 'ai' : null;
    if (path === '/api/ai/tenant-model/readiness')
        return m === 'GET' ? 'ai' : null;
    if (path === '/api/ai/tenant-model/train')
        return m === 'POST' ? 'ai' : null;
    if (path === '/api/ai/tenant-model/train/status')
        return m === 'GET' ? 'ai' : null;
    if (path === '/api/soar/playbooks')
        return m === 'GET' ? 'ai' : m === 'POST' ? 'ai' : null;
    if (path.startsWith('/api/ai/threats/')) {
        if (path === '/api/ai/threats/quarantined' || path === '/api/ai/threats/quarantine/policy') {
            return m === 'GET' || m === 'POST' ? 'read' : null;
        }
        return m === 'POST' ? 'policy_mutate' : null;
    }
    if (path.startsWith('/api/security/threats/')) {
        if (path === '/api/security/threats/quarantined'
            || path === '/api/security/threats/quarantine/policy') {
            return m === 'GET' || m === 'POST' ? 'read' : null;
        }
        return m === 'POST' ? 'policy_mutate' : null;
    }
    if (path === '/api/policy/reload' || path.startsWith('/api/policy/suggestions/')) {
        return m === 'POST' ? 'policy_mutate' : m === 'GET' ? 'read' : null;
    }
    if (path === '/api/policy') {
        if (m === 'GET')
            return 'read';
        if (m === 'PUT')
            return 'policy_mutate';
    }
    if (path === '/api/policy/fp/reject' && m === 'POST')
        return 'policy_mutate';
    if (path.startsWith('/api/learning/'))
        return m === 'GET' ? 'ai' : 'ai';
    if (path.startsWith('/api/security-swarm/')) {
        if (path === '/api/security-swarm/run' && m === 'POST')
            return 'policy_test';
        if ((path === '/api/security-swarm/threat-lab-candidates/accept'
            || path === '/api/security-swarm/threat-lab-candidates/reject')
            && m === 'POST') {
            return 'policy_mutate';
        }
        return m === 'GET' ? 'read' : null;
    }
    if (path === '/api/audit' || path === '/api/audit/heatmap' || path.startsWith('/api/audit?')) {
        return m === 'GET' ? 'read' : null;
    }
    if (path.startsWith('/api/admin/'))
        return m === 'GET' ? 'admin' : 'admin';
    if (path.startsWith('/api/ai/'))
        return m === 'GET' ? 'ai' : 'ai';
    if (path === '/api/logout')
        return 'read';
    // Gateway / fleet mutate surfaces — require policy_mutate when auth is on (Phase 5.4).
    if (path.startsWith('/api/gateway/')) {
        if (m === 'GET' || m === 'HEAD')
            return 'read';
        const mutateSuffixes = [
            '/protect',
            '/unprotect',
            '/lockdown',
            '/lockdown/release',
            '/escalation/resolve',
            '/policy/activate',
            '/self-test',
            '/threat-lab/from-receipt',
            '/threat-lab/from-receipt/review',
            '/threat-lab/corpus-replay',
            '/incidents',
            '/decide',
            '/scan',
        ];
        if (mutateSuffixes.some((s) => path === `/api/gateway${s}` || path.endsWith(s))) {
            return 'policy_mutate';
        }
        if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE')
            return 'policy_mutate';
        return 'read';
    }
    if (path.startsWith('/api/fleet/')) {
        if (m === 'GET' || m === 'HEAD')
            return 'read';
        return 'policy_mutate';
    }
    return null;
}
export function canAccessRoute(roles, method, url) {
    const perm = permissionForRoute(method, url);
    if (!perm)
        return { allowed: true };
    const minRole = PERMISSION_MIN_ROLE[perm];
    const ok = roles.some((r) => hasAtLeastRole(r, minRole));
    if (ok)
        return { allowed: true };
    return {
        allowed: false,
        required: perm,
        reason: `Requires ${minRole} role (have: ${roles.join(', ') || 'none'})`,
    };
}
export function resolveRolesFromSessionPayload(payload) {
    const ssoRoles = resolveSsoRolesFromClaims(payload);
    if (ssoRoles.length > 0)
        return ssoRoles;
    const out = [];
    if (payload.role) {
        const one = normalizeDashboardRole(payload.role);
        if (one)
            out.push(one);
    }
    if (Array.isArray(payload.roles)) {
        for (const r of payload.roles) {
            const n = normalizeDashboardRole(String(r));
            if (n && !out.includes(n))
                out.push(n);
        }
    }
    return out.length > 0 ? out : ['viewer'];
}
export function resolveRolesForApiKey(apiKey, mapping) {
    const jsonKeys = process.env['DASHBOARD_API_KEYS_JSON'];
    if (jsonKeys?.trim()) {
        try {
            const obj = JSON.parse(jsonKeys);
            for (const [compound] of Object.entries(obj)) {
                const parts = compound.split(':');
                if (parts.length >= 3) {
                    const rolePart = parts[1];
                    const secret = parts.slice(2).join(':');
                    if (secret === apiKey) {
                        const role = normalizeDashboardRole(rolePart || 'viewer');
                        if (role)
                            return [role];
                    }
                }
                if (compound === apiKey) {
                    const role = normalizeDashboardRole(obj[compound] || 'viewer');
                    if (role)
                        return [role];
                }
            }
        }
        catch {
            /* fall through */
        }
    }
    const map = mapping ?? parseDashboardRolesEnv();
    if (map.has(apiKey))
        return [map.get(apiKey)];
    for (const [prefix, role] of map) {
        if (apiKey.startsWith(prefix))
            return [role];
    }
    // The provisioned laptop/appliance key (DASHBOARD_API_KEY) is the operator
    // sitting at Shield. Viewer would 403 canary, grant, and lockdown POSTs.
    const primary = process.env['DASHBOARD_API_KEY']?.trim();
    if (primary && apiKey === primary) {
        const primaryRole = normalizeDashboardRole(process.env['MASTYF_AI_DASHBOARD_PRIMARY_ROLE'] || 'operator');
        return primaryRole ? [primaryRole] : ['operator'];
    }
    const defaultRole = normalizeDashboardRole(process.env['MASTYF_AI_DASHBOARD_DEFAULT_ROLE'] || 'viewer');
    return defaultRole ? [defaultRole] : ['viewer'];
}
/** True when `presented` is the provisioned appliance key or an explicit mapped key. */
export function isKnownDashboardApiKey(presented) {
    const key = presented.trim();
    if (!key)
        return false;
    const primary = process.env['DASHBOARD_API_KEY']?.trim();
    if (primary && key === primary)
        return true;
    const map = parseDashboardRolesEnv();
    if (map.has(key))
        return true;
    const jsonKeys = process.env['DASHBOARD_API_KEYS_JSON'];
    if (!jsonKeys?.trim())
        return false;
    try {
        const obj = JSON.parse(jsonKeys);
        for (const compound of Object.keys(obj)) {
            const parts = compound.split(':');
            if (parts.length >= 3 && parts.slice(2).join(':') === key)
                return true;
            if (compound === key)
                return true;
        }
    }
    catch {
        return false;
    }
    return false;
}
/** Map IdP group claim to dashboard roles via MASTYF_AI_DASHBOARD_SSO_ROLE_MAP JSON. */
export function resolveSsoRolesFromClaims(claims) {
    const claimName = process.env['MASTYF_AI_DASHBOARD_SSO_ROLE_CLAIM'] || 'groups';
    const rawMap = process.env['MASTYF_AI_DASHBOARD_SSO_ROLE_MAP'];
    if (!rawMap?.trim())
        return [];
    let groupMap;
    try {
        groupMap = JSON.parse(rawMap);
    }
    catch {
        return [];
    }
    const rawGroups = claims[claimName];
    const groups = Array.isArray(rawGroups)
        ? rawGroups.map(String)
        : typeof rawGroups === 'string'
            ? [rawGroups]
            : [];
    const out = [];
    for (const g of groups) {
        const mapped = groupMap[g];
        if (!mapped)
            continue;
        const role = normalizeDashboardRole(mapped);
        if (role && !out.includes(role))
            out.push(role);
    }
    return out;
}
/** tenant-admin may only act within session tenant. */
export function assertTenantAdminScope(roles, sessionTenantId, requestTenantId) {
    const isTenantAdmin = roles.includes('tenant-admin') && !roles.includes('admin');
    if (!isTenantAdmin)
        return { ok: true };
    const session = sessionTenantId || DEFAULT_TENANT_ID;
    if (session !== requestTenantId) {
        return {
            ok: false,
            reason: `tenant-admin scoped to '${session}', request tenant '${requestTenantId}'`,
        };
    }
    return { ok: true };
}
//# sourceMappingURL=dashboard-rbac.js.map