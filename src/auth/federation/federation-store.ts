import type { IdpConfig } from './federation-types.js';

interface FederationDbOps {
  all: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  run: (sql: string, params?: unknown[]) => Promise<{ changes: number }>;
}

export class FederationStore {
  constructor(private db: FederationDbOps) {}

  async listIdpConfigs(tenantId: string): Promise<IdpConfig[]> {
    const rows = await this.db.all(
      'SELECT * FROM auth_idp_configs WHERE tenant_id = ? ORDER BY name',
      [tenantId],
    );
    return rows.map(this.rowToConfig);
  }

  async getIdpConfig(tenantId: string, id: string): Promise<IdpConfig | null> {
    const rows = await this.db.all(
      'SELECT * FROM auth_idp_configs WHERE tenant_id = ? AND id = ?',
      [tenantId, id],
    );
    if (rows.length === 0) return null;
    return this.rowToConfig(rows[0]);
  }

  async createIdpConfig(config: IdpConfig): Promise<IdpConfig> {
    await this.db.run(
      `INSERT INTO auth_idp_configs (id, tenant_id, provider_type, name, issuer_url, client_id,
       client_secret, redirect_uri, scopes, claim_mappings, role_map, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.id,
        config.tenantId,
        config.providerType,
        config.name,
        config.issuerUrl,
        config.clientId,
        config.clientSecret,
        config.redirectUri,
        JSON.stringify(config.scopes),
        JSON.stringify(config.claimMappings),
        JSON.stringify(config.roleMap),
        config.enabled ? 1 : 0,
        config.createdAt,
        config.updatedAt,
      ],
    );
    return config;
  }

  async updateIdpConfig(tenantId: string, id: string, updates: Partial<IdpConfig>): Promise<IdpConfig | null> {
    const existing = await this.getIdpConfig(tenantId, id);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };

    await this.db.run(
      `UPDATE auth_idp_configs SET name = ?, issuer_url = ?, client_id = ?, client_secret = ?,
       redirect_uri = ?, scopes = ?, claim_mappings = ?, role_map = ?, enabled = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      [
        merged.name,
        merged.issuerUrl,
        merged.clientId,
        merged.clientSecret,
        merged.redirectUri,
        JSON.stringify(merged.scopes),
        JSON.stringify(merged.claimMappings),
        JSON.stringify(merged.roleMap),
        merged.enabled ? 1 : 0,
        merged.updatedAt,
        tenantId,
        id,
      ],
    );
    return merged;
  }

  async deleteIdpConfig(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db.run(
      'DELETE FROM auth_idp_configs WHERE tenant_id = ? AND id = ?',
      [tenantId, id],
    );
    return result.changes > 0;
  }

  async getEnabledProvidersForTenant(tenantId: string): Promise<IdpConfig[]> {
    const configs = await this.listIdpConfigs(tenantId);
    return configs.filter(c => c.enabled);
  }

  private rowToConfig(row: Record<string, unknown>): IdpConfig {
    return {
      id: row.id as string,
      tenantId: row.tenant_id as string,
      providerType: row.provider_type as IdpConfig['providerType'],
      name: row.name as string,
      issuerUrl: row.issuer_url as string,
      clientId: row.client_id as string,
      clientSecret: row.client_secret as string,
      redirectUri: row.redirect_uri as string,
      scopes: typeof row.scopes === 'string' ? JSON.parse(row.scopes as string) : (row.scopes as string[] || []),
      claimMappings: typeof row.claim_mappings === 'string' ? JSON.parse(row.claim_mappings as string) : (row.claim_mappings as object || {}),
      roleMap: typeof row.role_map === 'string' ? JSON.parse(row.role_map as string) : (row.role_map as object || {}),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

/** In-memory implementation for environments without the auth schema table */
export class InMemoryFederationStore extends FederationStore {
  private configs = new Map<string, IdpConfig>();

  constructor() {
    super({
      all: async (_sql: string, params?: unknown[]) => {
        const tenantId = params?.[0] as string;
        const results: IdpConfig[] = [];
        for (const [, config] of this.configs) {
          if (config.tenantId === tenantId) results.push(config);
        }
        return results.map(c => ({ ...c } as unknown as Record<string, unknown>));
      },
      run: async (_sql: string, params?: unknown[]) => {
        const [id, tenantId, providerType, name, issuerUrl, clientId, clientSecret,
          redirectUri, scopes, claimMappings, roleMap, enabled, createdAt, updatedAt] = params || [];
        this.configs.set(id as string, {
          id: id as string, tenantId: tenantId as string,
          providerType: providerType as IdpConfig['providerType'],
          name: name as string, issuerUrl: issuerUrl as string,
          clientId: clientId as string, clientSecret: clientSecret as string,
          redirectUri: redirectUri as string,
          scopes: typeof scopes === 'string' ? JSON.parse(scopes) : (scopes as string[] || []),
          claimMappings: typeof claimMappings === 'string' ? JSON.parse(claimMappings) : (claimMappings as object || {}),
          roleMap: typeof roleMap === 'string' ? JSON.parse(roleMap) : (roleMap as object || {}),
          enabled: Boolean(enabled), createdAt: createdAt as string, updatedAt: updatedAt as string,
        });
        return { changes: 1 };
      },
    });
  }
}
