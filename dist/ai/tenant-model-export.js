/**
 * Tenant LoRA training dataset export — shared by CLI and dashboard API.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { loadSemanticAuditRecordsAsync } from './semantic-audit-store.js';
import { isCalibratorSeededRecord } from './threat-lab.js';
import { buildLoraExportManifest, checkTenantModelReadiness, } from './tenant-semantic-model.js';
function resolveTenantForStore(tenantId) {
    return tenantId !== 'default' ? tenantId : undefined;
}
export async function loadTrainingRows(tenantId) {
    const records = await loadSemanticAuditRecordsAsync({
        tenantId: resolveTenantForStore(tenantId),
        sinceMs: 365 * 24 * 60 * 60 * 1000,
        limit: 10000,
    });
    const rows = [];
    for (const r of records) {
        if (!r.labeled || !r.label || r.label === 'ignored')
            continue;
        if (isCalibratorSeededRecord(r))
            continue;
        const argText = r.argumentsSnapshot
            ? JSON.stringify(r.argumentsSnapshot).slice(0, 400)
            : r.semanticAudit?.reasoning?.slice(0, 400) || r.toolName;
        rows.push({
            instruction: 'Classify this MCP tool call as true_positive (attack) or false_positive (benign).',
            input: `server=${r.serverName} tool=${r.toolName} args=${argText}`,
            output: r.label,
            attackClass: r.semanticAudit?.categories?.[0],
            toolName: r.toolName,
            serverName: r.serverName,
        });
    }
    return rows;
}
export function writeTrainingJsonl(outPath, rows) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, '');
    for (const row of rows) {
        writeFileSync(outPath, `${JSON.stringify(row)}\n`, { flag: 'a' });
    }
    return rows.length;
}
export function writeTenantModelfile(tenantId, modelName, rows, baseModel = process.env.MASTYF_AI_LORA_BASE_MODEL || 'qwen3:8b') {
    const modelfilePath = join(process.cwd(), 'exports', `Modelfile.${tenantId}`);
    mkdirSync(dirname(modelfilePath), { recursive: true });
    const examples = rows.slice(0, Math.min(24, rows.length));
    const messageBlocks = examples
        .map((r) => `MESSAGE user\n${r.input}\nMESSAGE assistant\n${r.output}`)
        .join('\n');
    const content = `FROM ${baseModel}
PARAMETER temperature 0.05
PARAMETER top_p 0.9
SYSTEM You are an MCP security classifier for tenant ${tenantId}. Respond with exactly true_positive or false_positive.
${messageBlocks}
`;
    writeFileSync(modelfilePath, content);
    return modelfilePath;
}
export async function exportTenantTrainingDataset(tenantId) {
    const readiness = await checkTenantModelReadiness(tenantId);
    const rows = await loadTrainingRows(tenantId);
    const exportPath = join(process.cwd(), readiness.exportPath);
    const rowsExported = writeTrainingJsonl(exportPath, rows);
    const manifest = buildLoraExportManifest(tenantId, rowsExported);
    const manifestPath = join(dirname(exportPath), `lora-manifest-${tenantId}.json`);
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, rowsExported }, null, 2));
    const modelfilePath = writeTenantModelfile(tenantId, manifest.modelName, rows);
    return {
        readiness,
        manifest,
        exportPath,
        modelfilePath,
        manifestPath,
        rowsExported,
        fewShotExamples: Math.min(24, rows.length),
    };
}
export function tenantExportDir(tenantId) {
    return join(process.cwd(), 'exports', 'tenant-models', tenantId);
}
export function tenantTrainJobPath(tenantId) {
    return join(tenantExportDir(tenantId), 'train-job.json');
}
//# sourceMappingURL=tenant-model-export.js.map