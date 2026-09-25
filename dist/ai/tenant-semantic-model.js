/**
 * Tenant-scoped semantic model — Phase 3 LoRA readiness gate + Ollama model resolution.
 */
import { loadSemanticAuditRecordsAsync } from './semantic-audit-store.js';
import { isCalibratorSeededRecord } from './threat-lab.js';
export const MIN_LORA_LABELED_ROWS = parseInt(process.env.MASTYF_AI_TENANT_LORA_MIN_ROWS || '500', 10);
export function tenantSemanticModelName(tenantId) {
    const slug = tenantId.replace(/[^a-zA-Z0-9_-]/g, '-');
    return `mastyf-ai-threat:${slug}`;
}
export function resolveTenantSemanticModel(tenantId) {
    const explicit = process.env.MASTYF_AI_SEMANTIC_LOCAL_MODEL?.trim();
    if (explicit)
        return explicit;
    if (!tenantId || tenantId === 'default')
        return null;
    if (process.env.MASTYF_AI_TENANT_SEMANTIC_MODEL !== 'true')
        return null;
    return tenantSemanticModelName(tenantId);
}
export async function checkTenantModelReadiness(tenantId) {
    const records = await loadSemanticAuditRecordsAsync({
        tenantId,
        sinceMs: 365 * 24 * 60 * 60 * 1000,
        limit: 10000,
    });
    const labeled = records.filter((r) => r.labeled && r.label && r.label !== 'ignored' && !isCalibratorSeededRecord(r));
    const minRequired = Number.isFinite(MIN_LORA_LABELED_ROWS) ? MIN_LORA_LABELED_ROWS : 500;
    const ready = labeled.length >= minRequired;
    const modelName = tenantSemanticModelName(tenantId);
    const exportPath = `exports/training-dataset-${tenantId}.jsonl`;
    return {
        tenantId,
        ready,
        labeledCount: labeled.length,
        minRequired,
        modelName,
        exportPath,
        message: ready
            ? `Ready for LoRA fine-tune — register ${modelName} in Ollama after export`
            : `Need ${minRequired - labeled.length} more labeled rows (${labeled.length}/${minRequired})`,
    };
}
export function buildLoraExportManifest(tenantId, rowCount) {
    const modelName = tenantSemanticModelName(tenantId);
    return {
        tenantId,
        modelName,
        rowCount,
        generatedAt: new Date().toISOString(),
        ollamaCreateHint: `pnpm ai:train-tenant-model -- --tenant=${tenantId} && MASTYF_AI_SEMANTIC_LOCAL_MODEL=${modelName} MASTYF_AI_TENANT_SEMANTIC_MODEL=true`,
    };
}
/** Resolve model for hot-path semantic routing — tenant model when registered and enabled. */
export function routeSemanticModelForTenant(tenantId) {
    const explicit = process.env.MASTYF_AI_SEMANTIC_LOCAL_MODEL?.trim();
    if (explicit)
        return { model: explicit, source: 'explicit' };
    const tenantModel = resolveTenantSemanticModel(tenantId);
    if (tenantModel)
        return { model: tenantModel, source: 'tenant' };
    return { model: null, source: 'default' };
}
//# sourceMappingURL=tenant-semantic-model.js.map