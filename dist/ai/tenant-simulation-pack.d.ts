export interface SimulationSeedCase {
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    observedBlocked: boolean;
    category: 'high_risk' | 'benign_like' | 'mixed';
}
export interface TenantSimulationPack {
    tenantId: string;
    generatedAt: string;
    totalRecordsScanned: number;
    toolFingerprint: Array<{
        toolName: string;
        calls: number;
        blockedRate: number;
    }>;
    seedCases: SimulationSeedCase[];
}
export declare function buildTenantSimulationPack(tenantId: string, records: Array<{
    toolName?: string;
    arguments?: Record<string, unknown>;
    blocked?: boolean;
}>, opts?: {
    maxSeeds?: number;
}): TenantSimulationPack;
//# sourceMappingURL=tenant-simulation-pack.d.ts.map