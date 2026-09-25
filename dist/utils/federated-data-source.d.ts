import type { IDatabase } from '../database/database-interface.js';
export type FederatedMode = 'unified' | 'postgres-direct' | 'sqlite-fleet' | 'local';
export type FederatedQueryContext = {
    mode: FederatedMode;
    dataSources: string[];
    db: IDatabase | null;
    region?: string;
};
export declare function resolveFederatedMode(localDb: IDatabase | null): FederatedMode;
export declare function resolveFederatedChartDb(localDb: IDatabase | null, tenantId: string | undefined, windowDaysInput: number, region?: string): Promise<FederatedQueryContext>;
export declare function listFederatedRegions(): Promise<string[]>;
//# sourceMappingURL=federated-data-source.d.ts.map