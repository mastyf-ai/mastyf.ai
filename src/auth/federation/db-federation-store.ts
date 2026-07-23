import { getPersistenceStore, type PersistenceStore } from '../../utils/persistence-store.js';
import type { IdpConfig } from './federation-types.js';

export class DbFederationStore {
  private store = getPersistenceStore();

  async listIdpConfigs(tenantId: string): Promise<IdpConfig[]> {
    return this.store.getSsoConfigs(tenantId).map(r => ({
      id: r.id, tenantId: r.tenant_id, providerType: r.provider_type as 'oidc' | 'saml',
      name: r.name, issuerUrl: r.issuer_url, clientId: r.client_id,
      clientSecret: r.client_secret, redirectUri: r.redirect_uri,
      scopes: JSON.parse(r.scopes), claimMappings: JSON.parse(r.claim_mappings),
      roleMap: JSON.parse(r.role_map), enabled: Boolean(r.enabled),
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  async getIdpConfig(tenantId: string, id: string): Promise<IdpConfig | null> {
    const r = this.store.getSsoConfig(tenantId, id);
    if (!r) return null;
    return {
      id: r.id, tenantId: r.tenant_id, providerType: r.provider_type as 'oidc' | 'saml',
      name: r.name, issuerUrl: r.issuer_url, clientId: r.client_id,
      clientSecret: r.client_secret, redirectUri: r.redirect_uri,
      scopes: JSON.parse(r.scopes), claimMappings: JSON.parse(r.claim_mappings),
      roleMap: JSON.parse(r.role_map), enabled: Boolean(r.enabled),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  async createIdpConfig(config: IdpConfig): Promise<IdpConfig> {
    this.store.saveSsoConfig({
      id: config.id, tenant_id: config.tenantId, provider_type: config.providerType,
      name: config.name, issuer_url: config.issuerUrl, client_id: config.clientId,
      client_secret: config.clientSecret, redirect_uri: config.redirectUri,
      scopes: JSON.stringify(config.scopes), claim_mappings: JSON.stringify(config.claimMappings),
      role_map: JSON.stringify(config.roleMap), enabled: config.enabled ? 1 : 0,
      created_at: config.createdAt || new Date().toISOString(),
      updated_at: config.updatedAt || new Date().toISOString(),
    });
    return config;
  }

  async updateIdpConfig(tenantId: string, id: string, updates: Partial<IdpConfig>): Promise<IdpConfig | null> {
    const existing = await this.getIdpConfig(tenantId, id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await this.createIdpConfig(merged);
    return merged;
  }

  async deleteIdpConfig(tenantId: string, id: string): Promise<boolean> {
    return this.store.deleteSsoConfig(tenantId, id);
  }

  async getEnabledProvidersForTenant(tenantId: string): Promise<IdpConfig[]> {
    const all = await this.listIdpConfigs(tenantId);
    return all.filter(c => c.enabled);
  }
}
