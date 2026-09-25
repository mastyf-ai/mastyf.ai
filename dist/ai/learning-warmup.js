import { Logger } from '../utils/logger.js';
import { isAiLearningEnabled } from '../utils/ai-enabled.js';
import { isSemanticAsyncEnabledForTenant } from '../tenant/tenant-semantic-config.js';
/** Opt-in only. Fresh installs and default `mastyf-ai start` runs must NOT seed demo data. */
export function isLearningWarmupEnabled() {
    const v = process.env.MASTYF_AI_LEARNING_WARMUP;
    return v === 'true' || v === 'force';
}
/** Populate call history + async semantic audits from corpus attack fixtures. */
export async function maybeRunLearningWarmup(opts) {
    if (!isLearningWarmupEnabled()) {
        return { seeded: 0, semanticRecords: 0, skipped: true, reason: 'disabled' };
    }
    const tenantId = opts.tenantId || 'default';
    const { loadSemanticAuditRecordsAsync } = await import('./semantic-audit-store.js');
    const sinceMs = 30 * 24 * 60 * 60 * 1000;
    const existing = await loadSemanticAuditRecordsAsync({ tenantId, limit: 1, sinceMs });
    if (existing.length > 0 && process.env.MASTYF_AI_LEARNING_WARMUP !== 'force') {
        return {
            seeded: 0,
            semanticRecords: existing.length,
            skipped: true,
            reason: 'semantic_records_exist',
        };
    }
    if (!isSemanticAsyncEnabledForTenant(tenantId)) {
        return { seeded: 0, semanticRecords: 0, skipped: true, reason: 'semantic_async_off' };
    }
    const limit = Math.max(1, parseInt(process.env.MASTYF_AI_LEARNING_WARMUP_SAMPLES || '12', 10) || 12);
    const { loadCorpusSamples, loadCorpusReplayPolicyEngine } = await import('./threat-lab.js');
    const samples = loadCorpusSamples({ limit });
    if (samples.length === 0) {
        return { seeded: 0, semanticRecords: 0, skipped: true, reason: 'no_corpus_fixtures' };
    }
    const policy = opts.policyEngine ?? loadCorpusReplayPolicyEngine();
    const serverName = opts.servers[0]?.name || 'mastyf-learning-warmup';
    const now = Date.now();
    let seeded = 0;
    for (const sample of samples) {
        const timestamp = new Date(now - seeded * 1000).toISOString();
        const ctx = {
            serverName,
            toolName: sample.toolName,
            arguments: sample.arguments ?? {},
            requestId: `warmup-${sample.id || seeded}`,
            requestTokens: 50,
            timestamp,
            tenantId,
        };
        let decision;
        if (policy) {
            decision = policy.evaluate(ctx);
        }
        else {
            decision = {
                action: sample.expected === 'pass' ? 'pass' : 'block',
                rule: sample.ruleHint || 'warmup-corpus',
                reason: `Corpus warmup fixture (${sample.category || 'attack'})`,
            };
        }
        const blocked = decision.action === 'block';
        const record = {
            serverName,
            toolName: sample.toolName,
            requestTokens: 50,
            responseTokens: 0,
            totalTokens: 50,
            durationMs: 8,
            timestamp,
            blocked,
            blockRule: blocked ? decision.rule : undefined,
            blockReason: blocked ? decision.reason : undefined,
            tenantId,
        };
        await opts.db.addCallRecord(record);
        const { buildSemanticAuditJob, enqueueSemanticAudit } = await import('./async-semantic-audit.js');
        enqueueSemanticAudit(buildSemanticAuditJob(ctx, decision));
        seeded++;
    }
    const flushMs = parseInt(process.env.MASTYF_AI_LEARNING_WARMUP_FLUSH_MS || '25000', 10) || 25000;
    const { flushSemanticAuditQueue } = await import('./async-semantic-audit.js');
    await flushSemanticAuditQueue(flushMs);
    // Guarantee dashboard-visible semantic rows even when LLM/local async skips persistence.
    const { appendSemanticAuditRecord } = await import('./semantic-audit-store.js');
    const { snapshotAuditArguments } = await import('../utils/audit-args-snapshot.js');
    for (const sample of samples) {
        const timestamp = new Date(now - seeded * 1000).toISOString();
        const blocked = sample.expected !== 'pass';
        appendSemanticAuditRecord({
            requestId: `warmup-${sample.id || sample.toolName}`,
            serverName,
            toolName: sample.toolName,
            syncDecision: {
                action: blocked ? 'block' : 'pass',
                rule: sample.ruleHint || 'corpus-warmup',
                reason: `Learning warmup corpus fixture (${sample.category || 'attack'})`,
            },
            semanticAudit: {
                suspicious: blocked,
                confidence: blocked ? 0.82 : 0.35,
                categories: [sample.category || 'prompt-injection'],
                reasoning: `Corpus warmup: ${sample.id || sample.toolName} (${sample.category || 'attack'})`,
            },
            model: 'learning-warmup',
            timestamp,
            argumentsSnapshot: snapshotAuditArguments(sample.arguments ?? {}),
        });
    }
    const records = await loadSemanticAuditRecordsAsync({ tenantId, limit: 200, sinceMs });
    if (isAiLearningEnabled()) {
        const { runLearningCycleForDb } = await import('./suggestion-engine.js');
        const warmupServers = opts.servers.length > 0
            ? opts.servers
            : [{ name: serverName, transport: 'stdio' }];
        await runLearningCycleForDb(opts.db, warmupServers);
    }
    Logger.info(`[learning-warmup] Seeded ${seeded} corpus samples → ${records.length} semantic audit record(s) for tenant "${tenantId}"`);
    return { seeded, semanticRecords: records.length, skipped: false };
}
//# sourceMappingURL=learning-warmup.js.map