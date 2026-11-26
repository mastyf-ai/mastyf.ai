/**
 * Tenant provisioning API — CRUD tenants, policy files, quotas.
 * Mount via control-plane server when MASTYF_AI_TENANT_API_ENABLED=true.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { join, resolve, sep } from 'path';
import { Logger } from '../utils/logger.js';
import { parsePolicyConfig, formatPolicyValidationErrors } from '../policy/policy-schema.js';
import { load } from 'js-yaml';

export interface TenantRecord {
  id: string;
  displayName: string;
  policyPath: string;
  dailyBudgetUsd?: number;
  createdAt: string;
  updatedAt: string;
}

const TENANTS_ROOT = process.env['MASTYF_AI_TENANTS_DIR'] || 'policy-templates/tenants';

const TENANT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Directory for one tenant. Tenant ids come from API requests, so they must be plain names:
 * anything like "../x" would otherwise let a caller read, overwrite or delete other folders.
 */
function tenantDir(id: string): string {
  if (!TENANT_ID_RE.test(id)) throw new Error(`Invalid tenant id '${id}'`);
  const root = resolve(TENANTS_ROOT);
  const dir = resolve(root, id);
  if (!dir.startsWith(root + sep)) throw new Error(`Invalid tenant id '${id}'`);
  return dir;
}

function tenantPolicyPath(id: string): string {
  return join(tenantDir(id), 'policy.yaml');
}

function metaPath(id: string): string {
  return join(tenantDir(id), 'tenant.json');
}

export function listTenants(): TenantRecord[] {
  if (!existsSync(TENANTS_ROOT)) return [];
  return readdirSync(TENANTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => getTenant(d.name))
    .filter((t): t is TenantRecord => t != null);
}

export function getTenant(id: string): TenantRecord | null {
  if (!TENANT_ID_RE.test(id)) return null;
  const metaFile = metaPath(id);
  if (!existsSync(metaFile)) return null;
  return JSON.parse(readFileSync(metaFile, 'utf-8')) as TenantRecord;
}

export function createTenant(input: {
  id: string;
  displayName: string;
  policyYaml?: string;
  dailyBudgetUsd?: number;
}): TenantRecord {
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(id)) {
    throw new Error('Invalid tenant id');
  }
  const dir = tenantDir(id);
  if (existsSync(dir)) throw new Error(`Tenant '${id}' already exists`);
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const policyYaml = input.policyYaml || "version: '1.0'\npolicy:\n  mode: block\n  rules: []\n";
  parsePolicyConfig(load(policyYaml));
  writeFileSync(tenantPolicyPath(id), policyYaml, 'utf-8');
  const record: TenantRecord = {
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

export function updateTenantPolicy(id: string, policyYaml: string): TenantRecord {
  const existing = getTenant(id);
  if (!existing) throw new Error(`Tenant '${id}' not found`);
  try {
    parsePolicyConfig(load(policyYaml));
  } catch (err) {
    throw new Error(formatPolicyValidationErrors(err).map((e) => e.message).join('; '));
  }
  writeFileSync(tenantPolicyPath(id), policyYaml, 'utf-8');
  const updated: TenantRecord = { ...existing, updatedAt: new Date().toISOString() };
  writeFileSync(metaPath(id), JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

export function deleteTenant(id: string): void {
  const dir = tenantDir(id);
  if (!existsSync(dir)) throw new Error(`Tenant '${id}' not found`);
  rmSync(dir, { recursive: true, force: true });
  Logger.info(`[tenant-api] Deleted tenant ${id}`);
}

export function registerTenantApiRoutes(
  app: { get: Function; post: Function; put: Function; delete: Function },
): void {
  app.get('/api/tenants', (_req: unknown, res: { json: (v: unknown) => void }) => {
    res.json({ tenants: listTenants() });
  });
  app.post('/api/tenants', (req: { body: Record<string, unknown> }, res: { status: (n: number) => { json: (v: unknown) => void } }) => {
    try {
      const record = createTenant({
        id: String(req.body.id || ''),
        displayName: String(req.body.displayName || req.body.id || ''),
        policyYaml: req.body.policyYaml ? String(req.body.policyYaml) : undefined,
        dailyBudgetUsd: req.body.dailyBudgetUsd != null ? Number(req.body.dailyBudgetUsd) : undefined,
      });
      res.status(201).json(record);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.put('/api/tenants/:id/policy', (req: { params: { id: string }; body: { policyYaml?: string } }, res: { status: (n: number) => { json: (v: unknown) => void } }) => {
    try {
      const record = updateTenantPolicy(req.params.id, String(req.body.policyYaml || ''));
      res.status(200).json(record);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.delete('/api/tenants/:id', (req: { params: { id: string } }, res: { status: (n: number) => { json: (v: unknown) => void } }) => {
    try {
      deleteTenant(req.params.id);
      res.status(204).json({});
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
