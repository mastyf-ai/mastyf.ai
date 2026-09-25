/**
 * Tenant provisioning API — CRUD tenants, policy files, quotas, fleet identity (OS6).
 * Mount via control-plane server when MASTYF_AI_TENANT_API_ENABLED=true.
 *
 * Fleet identity answers: who may install, which servers/tools/data/destinations,
 * who may approve — fail-closed when fleet policy is present and role missing.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { Logger } from '../utils/logger.js';
import { parsePolicyConfig, formatPolicyValidationErrors } from '../policy/policy-schema.js';
import { load } from 'js-yaml';
export const DEFAULT_FLEET_IDENTITY = {
    installRoles: ['admin', 'security'],
    approveRoles: ['admin', 'security'],
    allowedServers: [],
    allowedTools: [],
    allowedDataLabels: [],
    allowedDestinations: [],
};
function fleetPath(id) {
    return join(tenantDir(id), 'fleet-identity.json');
}
export function getFleetIdentity(tenantId) {
    const tenant = getTenant(tenantId);
    if (!tenant)
        return null;
    if (tenant.fleet)
        return tenant.fleet;
    const fp = fleetPath(tenantId);
    if (!existsSync(fp))
        return null;
    return JSON.parse(readFileSync(fp, 'utf-8'));
}
export function setFleetIdentity(tenantId, fleet) {
    const existing = getTenant(tenantId);
    if (!existing)
        throw new Error(`Tenant '${tenantId}' not found`);
    writeFileSync(fleetPath(tenantId), JSON.stringify(fleet, null, 2), 'utf-8');
    const updated = {
        ...existing,
        fleet,
        updatedAt: new Date().toISOString(),
    };
    writeFileSync(metaPath(tenantId), JSON.stringify(updated, null, 2), 'utf-8');
    Logger.info(`[tenant-api] Updated fleet identity for ${tenantId}`);
    return updated;
}
/**
 * Evaluate whether a role may perform an org action against fleet policy.
 * No fleet policy → UNAVAILABLE (caller decides; gateway mutate treats as allow-with-note when unset).
 */
export function evaluateFleetPermission(params) {
    const fleet = getFleetIdentity(params.tenantId);
    if (!fleet) {
        return {
            allowed: false,
            reason: 'fleet identity not configured for tenant',
            required: [],
            status: 'UNAVAILABLE',
        };
    }
    const role = (params.role || '').trim().toLowerCase();
    const roleList = params.action === 'approve' ? fleet.approveRoles : fleet.installRoles;
    const required = roleList.map((r) => r.toLowerCase());
    if (!role || !required.includes(role)) {
        return {
            allowed: false,
            reason: `role '${params.role || ''}' not permitted for ${params.action}`,
            required: roleList,
            status: 'DENIED',
        };
    }
    if (params.server && fleet.allowedServers.length > 0 && !fleet.allowedServers.includes(params.server) && !fleet.allowedServers.includes('*')) {
        return {
            allowed: false,
            reason: `server '${params.server}' not in fleet allowlist`,
            required: roleList,
            status: 'DENIED',
        };
    }
    if (params.tool && fleet.allowedTools.length > 0 && !fleet.allowedTools.includes(params.tool) && !fleet.allowedTools.includes('*')) {
        return {
            allowed: false,
            reason: `tool '${params.tool}' not in fleet allowlist`,
            required: roleList,
            status: 'DENIED',
        };
    }
    if (params.destination && fleet.allowedDestinations.length > 0 && !fleet.allowedDestinations.includes(params.destination) && !fleet.allowedDestinations.includes('*')) {
        return {
            allowed: false,
            reason: `destination '${params.destination}' not in fleet allowlist`,
            required: roleList,
            status: 'DENIED',
        };
    }
    if (params.dataLabel && fleet.allowedDataLabels.length > 0 && !fleet.allowedDataLabels.includes(params.dataLabel) && !fleet.allowedDataLabels.includes('*')) {
        return {
            allowed: false,
            reason: `data label '${params.dataLabel}' not in fleet allowlist`,
            required: roleList,
            status: 'DENIED',
        };
    }
    return { allowed: true, reason: 'fleet identity permits action', required: roleList, status: 'ALLOWED' };
}
const TENANTS_ROOT = process.env['MASTYF_AI_TENANTS_DIR'] || 'policy-templates/tenants';
function tenantDir(id) {
    return join(TENANTS_ROOT, id);
}
function tenantPolicyPath(id) {
    return join(tenantDir(id), 'policy.yaml');
}
function metaPath(id) {
    return join(tenantDir(id), 'tenant.json');
}
export function listTenants() {
    if (!existsSync(TENANTS_ROOT))
        return [];
    return readdirSync(TENANTS_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => getTenant(d.name))
        .filter((t) => t != null);
}
export function getTenant(id) {
    const metaFile = metaPath(id);
    if (!existsSync(metaFile))
        return null;
    return JSON.parse(readFileSync(metaFile, 'utf-8'));
}
export function createTenant(input) {
    const id = input.id.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(id)) {
        throw new Error('Invalid tenant id');
    }
    const dir = tenantDir(id);
    if (existsSync(dir))
        throw new Error(`Tenant '${id}' already exists`);
    mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    const policyYaml = input.policyYaml || "version: '1.0'\npolicy:\n  mode: block\n  rules: []\n";
    parsePolicyConfig(load(policyYaml));
    writeFileSync(tenantPolicyPath(id), policyYaml, 'utf-8');
    const record = {
        id,
        displayName: input.displayName,
        policyPath: tenantPolicyPath(id),
        dailyBudgetUsd: input.dailyBudgetUsd,
        createdAt: now,
        updatedAt: now,
    };
    writeFileSync(metaPath(id), JSON.stringify(record, null, 2), 'utf-8');
    Logger.info(`[tenant-api] Created tenant ${id}`);
    return record;
}
export function updateTenantPolicy(id, policyYaml) {
    const existing = getTenant(id);
    if (!existing)
        throw new Error(`Tenant '${id}' not found`);
    try {
        parsePolicyConfig(load(policyYaml));
    }
    catch (err) {
        throw new Error(formatPolicyValidationErrors(err).map((e) => e.message).join('; '));
    }
    writeFileSync(tenantPolicyPath(id), policyYaml, 'utf-8');
    const updated = { ...existing, updatedAt: new Date().toISOString() };
    writeFileSync(metaPath(id), JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
}
export function deleteTenant(id) {
    const dir = tenantDir(id);
    if (!existsSync(dir))
        throw new Error(`Tenant '${id}' not found`);
    rmSync(dir, { recursive: true, force: true });
    Logger.info(`[tenant-api] Deleted tenant ${id}`);
}
export function registerTenantApiRoutes(app) {
    app.get('/api/tenants', (_req, res) => {
        res.json({ tenants: listTenants() });
    });
    app.post('/api/tenants', (req, res) => {
        try {
            const record = createTenant({
                id: String(req.body.id || ''),
                displayName: String(req.body.displayName || req.body.id || ''),
                policyYaml: req.body.policyYaml ? String(req.body.policyYaml) : undefined,
                dailyBudgetUsd: req.body.dailyBudgetUsd != null ? Number(req.body.dailyBudgetUsd) : undefined,
            });
            res.status(201).json(record);
        }
        catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.put('/api/tenants/:id/policy', (req, res) => {
        try {
            const record = updateTenantPolicy(req.params.id, String(req.body.policyYaml || ''));
            res.status(200).json(record);
        }
        catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.delete('/api/tenants/:id', (req, res) => {
        try {
            deleteTenant(req.params.id);
            res.status(204).json({});
        }
        catch (err) {
            res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.get('/api/tenants/:id/fleet', (req, res) => {
        const fleet = getFleetIdentity(req.params.id);
        if (!getTenant(req.params.id)) {
            res.status(404).json({ error: 'tenant not found', status: 'UNAVAILABLE' });
            return;
        }
        if (!fleet) {
            res.status(200).json({ status: 'UNAVAILABLE', fleet: null, reason: 'fleet identity not configured' });
            return;
        }
        res.json({ status: 'LOADED', fleet });
    });
    app.put('/api/tenants/:id/fleet', (req, res) => {
        try {
            const body = req.body || {};
            const fleet = {
                installRoles: Array.isArray(body.installRoles) ? body.installRoles.map(String) : DEFAULT_FLEET_IDENTITY.installRoles,
                approveRoles: Array.isArray(body.approveRoles) ? body.approveRoles.map(String) : DEFAULT_FLEET_IDENTITY.approveRoles,
                allowedServers: Array.isArray(body.allowedServers) ? body.allowedServers.map(String) : [],
                allowedTools: Array.isArray(body.allowedTools) ? body.allowedTools.map(String) : [],
                allowedDataLabels: Array.isArray(body.allowedDataLabels) ? body.allowedDataLabels.map(String) : [],
                allowedDestinations: Array.isArray(body.allowedDestinations) ? body.allowedDestinations.map(String) : [],
            };
            const record = setFleetIdentity(req.params.id, fleet);
            res.status(200).json(record);
        }
        catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });
    app.post('/api/tenants/:id/fleet/check', (req, res) => {
        const result = evaluateFleetPermission({
            tenantId: req.params.id,
            role: req.body?.role,
            action: req.body?.action || 'mutate',
            server: req.body?.server,
            tool: req.body?.tool,
            destination: req.body?.destination,
            dataLabel: req.body?.dataLabel,
        });
        res.status(result.status === 'DENIED' ? 403 : 200).json(result);
    });
}
//# sourceMappingURL=tenant-api.js.map