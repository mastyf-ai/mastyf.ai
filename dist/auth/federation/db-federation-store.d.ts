import type { IdpConfig } from './federation-types.js';
export declare class DbFederationStore {
    private store;
    listIdpConfigs(tenantId: string): Promise<IdpConfig[]>;
    getIdpConfig(tenantId: string, id: string): Promise<IdpConfig | null>;
    createIdpConfig(config: IdpConfig): Promise<IdpConfig>;
    updateIdpConfig(tenantId: string, id: string, updates: Partial<IdpConfig>): Promise<IdpConfig | null>;
    deleteIdpConfig(tenantId: string, id: string): Promise<boolean>;
    getEnabledProvidersForTenant(tenantId: string): Promise<IdpConfig[]>;
}
//# sourceMappingURL=db-federation-store.d.ts.map