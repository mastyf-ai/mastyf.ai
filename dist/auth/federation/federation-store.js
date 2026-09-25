export class FederationStore {
    db;
    constructor(db) {
        this.db = db;
    }
    async listIdpConfigs(tenantId) {
        const rows = await this.db.all('SELECT * FROM auth_idp_configs WHERE tenant_id = ? ORDER BY name', [tenantId]);
        return rows.map(this.rowToConfig);
    }
    async getIdpConfig(tenantId, id) {
        const rows = await this.db.all('SELECT * FROM auth_idp_configs WHERE tenant_id = ? AND id = ?', [tenantId, id]);
        if (rows.length === 0)
            return null;
        return this.rowToConfig(rows[0]);
    }
    async createIdpConfig(config) {
        await this.db.run(`INSERT INTO auth_idp_configs (id, tenant_id, provider_type, name, issuer_url, client_id,
       client_secret, redirect_uri, scopes, claim_mappings, role_map, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
        ]);
        return config;
    }
    async updateIdpConfig(tenantId, id, updates) {
        const existing = await this.getIdpConfig(tenantId, id);
        if (!existing)
            return null;
        const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
        await this.db.run(`UPDATE auth_idp_configs SET name = ?, issuer_url = ?, client_id = ?, client_secret = ?,
       redirect_uri = ?, scopes = ?, claim_mappings = ?, role_map = ?, enabled = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`, [
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
        ]);
        return merged;
    }
    async deleteIdpConfig(tenantId, id) {
        const result = await this.db.run('DELETE FROM auth_idp_configs WHERE tenant_id = ? AND id = ?', [tenantId, id]);
        return result.changes > 0;
    }
    async getEnabledProvidersForTenant(tenantId) {
        const configs = await this.listIdpConfigs(tenantId);
        return configs.filter(c => c.enabled);
    }
    rowToConfig(row) {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            providerType: row.provider_type,
            name: row.name,
            issuerUrl: row.issuer_url,
            clientId: row.client_id,
            clientSecret: row.client_secret,
            redirectUri: row.redirect_uri,
            scopes: typeof row.scopes === 'string' ? JSON.parse(row.scopes) : (row.scopes || []),
            claimMappings: typeof row.claim_mappings === 'string' ? JSON.parse(row.claim_mappings) : (row.claim_mappings || {}),
            roleMap: typeof row.role_map === 'string' ? JSON.parse(row.role_map) : (row.role_map || {}),
            enabled: Boolean(row.enabled),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
/** In-memory implementation for environments without the auth schema table */
export class InMemoryFederationStore extends FederationStore {
    configs = new Map();
    constructor() {
        super({
            all: async (_sql, params) => {
                const tenantId = params?.[0];
                const results = [];
                for (const [, config] of this.configs) {
                    if (config.tenantId === tenantId)
                        results.push(config);
                }
                return results.map(c => ({ ...c }));
            },
            run: async (_sql, params) => {
                const [id, tenantId, providerType, name, issuerUrl, clientId, clientSecret, redirectUri, scopes, claimMappings, roleMap, enabled, createdAt, updatedAt] = params || [];
                this.configs.set(id, {
                    id: id, tenantId: tenantId,
                    providerType: providerType,
                    name: name, issuerUrl: issuerUrl,
                    clientId: clientId, clientSecret: clientSecret,
                    redirectUri: redirectUri,
                    scopes: typeof scopes === 'string' ? JSON.parse(scopes) : (scopes || []),
                    claimMappings: typeof claimMappings === 'string' ? JSON.parse(claimMappings) : (claimMappings || {}),
                    roleMap: typeof roleMap === 'string' ? JSON.parse(roleMap) : (roleMap || {}),
                    enabled: Boolean(enabled), createdAt: createdAt, updatedAt: updatedAt,
                });
                return { changes: 1 };
            },
        });
    }
}
//# sourceMappingURL=federation-store.js.map