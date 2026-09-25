import { type LoraExportManifest, type TenantModelReadiness } from './tenant-semantic-model.js';
export type TrainingRow = {
    instruction: string;
    input: string;
    output: string;
    attackClass?: string;
    toolName: string;
    serverName: string;
};
export type TenantModelExportResult = {
    readiness: TenantModelReadiness;
    manifest: LoraExportManifest;
    exportPath: string;
    modelfilePath: string;
    manifestPath: string;
    rowsExported: number;
    fewShotExamples: number;
};
export declare function loadTrainingRows(tenantId: string): Promise<TrainingRow[]>;
export declare function writeTrainingJsonl(outPath: string, rows: TrainingRow[]): number;
export declare function writeTenantModelfile(tenantId: string, modelName: string, rows: TrainingRow[], baseModel?: string): string;
export declare function exportTenantTrainingDataset(tenantId: string): Promise<TenantModelExportResult>;
export declare function tenantExportDir(tenantId: string): string;
export declare function tenantTrainJobPath(tenantId: string): string;
//# sourceMappingURL=tenant-model-export.d.ts.map