export declare const MIN_LORA_LABELED_ROWS: number;
export type TenantModelReadiness = {
    tenantId: string;
    ready: boolean;
    labeledCount: number;
    minRequired: number;
    modelName: string;
    exportPath: string;
    message: string;
};
export declare function tenantSemanticModelName(tenantId: string): string;
export declare function resolveTenantSemanticModel(tenantId?: string): string | null;
export declare function checkTenantModelReadiness(tenantId: string): Promise<TenantModelReadiness>;
export type LoraExportManifest = {
    tenantId: string;
    modelName: string;
    rowCount: number;
    generatedAt: string;
    ollamaCreateHint: string;
};
export declare function buildLoraExportManifest(tenantId: string, rowCount: number): LoraExportManifest;
/** Resolve model for hot-path semantic routing — tenant model when registered and enabled. */
export declare function routeSemanticModelForTenant(tenantId?: string): {
    model: string | null;
    source: 'explicit' | 'tenant' | 'default';
};
//# sourceMappingURL=tenant-semantic-model.d.ts.map