/**
 * Per-tenant semantic layer overrides via GUARDIAN_TENANT_SEMANTIC_JSON.
 *
 * Example:
 * {"acme":{"syncResponse":true,"async":true},"beta":{"syncResponse":false,"strict":true}}
 */
export interface TenantSemanticOverrides {
  localSemantic?: boolean;
  syncResponse?: boolean;
  syncResponseLlm?: boolean;
  syncRequest?: boolean;
  syncRequestLlm?: boolean;
  asyncAudit?: boolean;
  strict?: boolean;
}

let cachedMap: Map<string, TenantSemanticOverrides> | null = null;

function loadTenantSemanticMap(): Map<string, TenantSemanticOverrides> {
  if (cachedMap) return cachedMap;
  cachedMap = new Map();
  const raw = process.env['GUARDIAN_TENANT_SEMANTIC_JSON'];
  if (!raw?.trim()) return cachedMap;
  try {
    const obj = JSON.parse(raw) as Record<string, TenantSemanticOverrides>;
    for (const [tenant, cfg] of Object.entries(obj)) {
      if (cfg && typeof cfg === 'object') cachedMap.set(tenant, cfg);
    }
  } catch {
    cachedMap = new Map();
  }
  return cachedMap;
}

/** @internal */
export function resetTenantSemanticConfigForTests(): void {
  cachedMap = null;
  delete process.env.GUARDIAN_TENANT_SEMANTIC_JSON;
}

export function getTenantSemanticOverrides(tenantId?: string): TenantSemanticOverrides | undefined {
  if (!tenantId) return undefined;
  return loadTenantSemanticMap().get(tenantId);
}

export function isLocalSemanticEnabledForTenant(tenantId?: string): boolean {
  const o = getTenantSemanticOverrides(tenantId);
  if (o?.localSemantic !== undefined) return o.localSemantic;
  return isLocalSemanticEnabledGlobal();
}

export function isLocalSemanticEnabledGlobal(): boolean {
  if (process.env['GUARDIAN_LOCAL_SEMANTIC'] === 'false') return false;
  if (process.env['GUARDIAN_LOCAL_SEMANTIC'] === 'true') return true;
  return process.env['GUARDIAN_DISABLE_SEMANTIC'] !== 'true';
}

/** Global sync-response gate — production defaults on unless explicitly disabled. */
export function isSyncSemanticResponseEnabledGlobal(): boolean {
  const explicit = process.env['GUARDIAN_SEMANTIC_SYNC_RESPONSE'];
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export function isSyncSemanticResponseEnabledForTenant(tenantId?: string): boolean {
  const o = getTenantSemanticOverrides(tenantId);
  if (o?.syncResponse !== undefined) return o.syncResponse;
  return isSyncSemanticResponseEnabledGlobal();
}

export function isSyncSemanticLlmEnabledForTenant(tenantId?: string): boolean {
  const o = getTenantSemanticOverrides(tenantId);
  if (o?.syncResponseLlm !== undefined) return o.syncResponseLlm;
  return (
    isSyncSemanticResponseEnabledForTenant(tenantId)
    && process.env['GUARDIAN_SEMANTIC_SYNC_RESPONSE_LLM'] === 'true'
  );
}

export function isSemanticAsyncEnabledForTenant(tenantId?: string): boolean {
  const o = getTenantSemanticOverrides(tenantId);
  if (o?.asyncAudit !== undefined) return o.asyncAudit;
  if (process.env['GUARDIAN_SEMANTIC_ASYNC'] === 'false') return false;
  if (process.env['GUARDIAN_SEMANTIC_ASYNC'] === 'true') return true;
  return process.env['GUARDIAN_LLM_ENABLED'] !== 'false';
}

export function isSemanticStrictForTenant(tenantId?: string): boolean {
  const o = getTenantSemanticOverrides(tenantId);
  if (o?.strict !== undefined) return o.strict;
  return process.env['GUARDIAN_SEMANTIC_STRICT'] === 'true';
}

export function isEnterpriseMode(): boolean {
  return process.env['GUARDIAN_ENTERPRISE_MODE'] === 'true';
}

/** Sync request gate — ON by default in enterprise when LLM is available. */
export function isSyncSemanticRequestEnabledGlobal(): boolean {
  const explicit = process.env['GUARDIAN_SEMANTIC_SYNC_REQUEST'];
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return isEnterpriseMode();
}

export function isSyncSemanticRequestEnabledForTenant(tenantId?: string): boolean {
  const o = getTenantSemanticOverrides(tenantId);
  if (o?.syncRequest !== undefined) return o.syncRequest;
  return isSyncSemanticRequestEnabledGlobal();
}

export function isSyncSemanticRequestLlmEnabledForTenant(tenantId?: string): boolean {
  const o = getTenantSemanticOverrides(tenantId);
  if (o?.syncRequestLlm !== undefined) return o.syncRequestLlm;
  if (process.env['GUARDIAN_SEMANTIC_SYNC_REQUEST_LLM'] === 'false') return false;
  if (process.env['GUARDIAN_SEMANTIC_SYNC_REQUEST_LLM'] === 'true') return true;
  return isSyncSemanticRequestEnabledForTenant(tenantId) && isEnterpriseMode();
}
