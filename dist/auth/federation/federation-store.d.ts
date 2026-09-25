import type { IdpConfig } from './federation-types.js';
interface FederationDbOps {
    all: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    run: (sql: string, params?: unknown[]) => Promise<{
        changes: number;
    }>;
}
export declare class FederationStore {
    private db;
    constructor(db: FederationDbOps);
    listIdpConfigs(tenantId: string): Promise<IdpConfig[]>;
    getIdpConfig(tenantId: string, id: string): Promise<IdpConfig | null>;
    createIdpConfig(config: IdpConfig): Promise<IdpConfig>;
    updateIdpConfig(tenantId: string, id: string, updates: Partial<IdpConfig>): Promise<IdpConfig | null>;
    deleteIdpConfig(tenantId: string, id: string): Promise<boolean>;
    getEnabledProvidersForTenant(tenantId: string): Promise<IdpConfig[]>;
    private rowToConfig;
}
/** In-memory implementation for environments without the auth schema table */
export declare class InMemoryFederationStore extends FederationStore {
    private configs;
    constructor();
}
export {};
//# sourceMappingURL=federation-store.d.ts.map