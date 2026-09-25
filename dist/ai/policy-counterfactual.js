/**
 * Counterfactual Policy Simulator — batch replay with stored/corpus-resolved arguments.
 */
import { readFileSync, existsSync } from 'fs';
import { load } from 'js-yaml';
import { loadSemanticAuditRecordsAsync } from './semantic-audit-store.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { resolveReplaySample, summarizeReplaySources, } from './counterfactual-replay-source.js';
function defaultPolicyPath() {
    return process.env.MASTYF_AI_POLICY_PATH || process.env.MASTYF_AI_POLICY_PATH || 'default-policy.yaml';
}
function loadPolicyConfig(path) {
    const p = path || defaultPolicyPath();
    if (!existsSync(p))
        return null;
    try {
        return load(readFileSync(p, 'utf-8'));
    }
    catch {
        return null;
    }
}
function buildEngine(config, prependRule) {
    const rules = prependRule ? [prependRule, ...(config.policy?.rules || [])] : config.policy?.rules || [];
    const merged = {
        ...config,
        policy: { ...config.policy, mode: 'block', rules },
    };
    return new PolicyEngine(merged);
}
function evalSample(engine, sample, rec) {
    const ctx = {
        serverName: sample.serverName,
        toolName: sample.toolName,
        arguments: sample.arguments,
        requestId: rec.requestId || rec.id,
        requestTokens: 50,
        timestamp: rec.timestamp,
    };
    const d = engine.evaluate(ctx);
    return { action: d.action, rule: d.rule };
}
function normalizeAction(action) {
    if (action === 'block')
        return 'block';
    if (action === 'flag')
        return 'flag';
    return 'pass';
}
function computeFpRisk(deltas, records) {
    const labeledPass = records.filter((r) => r.labeled && r.label === 'false_positive');
    if (!labeledPass.length)
        return 0;
    let risky = 0;
    for (const r of labeledPass) {
        const d = deltas.find((x) => x.id === r.id);
        if (d && d.direction === 'new_block')
            risky += 1;
    }
    return Math.round((risky / labeledPass.length) * 1000) / 1000;
}
export async function simulatePolicyCounterfactual(opts) {
    const windowDays = opts.windowDays ?? 14;
    const config = loadPolicyConfig(opts.policyPath);
    if (!config) {
        return {
            generatedAt: new Date().toISOString(),
            windowDays,
            sampleCount: 0,
            newBlocks: 0,
            newPasses: 0,
            unchanged: 0,
            fpRiskScore: 0,
            argSources: { storedArgs: 0, corpusMatch: 0, empty: 0 },
            deltas: [],
            summary: 'Policy file not found or invalid',
        };
    }
    const baselineEngine = buildEngine(config);
    const counterEngine = opts.draftRule ? buildEngine(config, opts.draftRule) : baselineEngine;
    const records = await loadSemanticAuditRecordsAsync({
        tenantId: opts.tenantId,
        sinceMs: windowDays * 24 * 60 * 60 * 1000,
        limit: opts.limit ?? 500,
    });
    const replaySamples = records.map((r) => resolveReplaySample(r));
    const argSources = summarizeReplaySources(replaySamples);
    const deltas = [];
    for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const sample = replaySamples[i];
        const baseline = evalSample(baselineEngine, sample, rec);
        const counter = evalSample(counterEngine, sample, rec);
        const baselineAction = normalizeAction(baseline.action);
        const counterfactualAction = normalizeAction(counter.action);
        const changed = baselineAction !== counterfactualAction;
        let direction = 'unchanged';
        if (changed) {
            const wasPass = baselineAction === 'pass';
            const nowBlock = counterfactualAction === 'block' || counterfactualAction === 'flag';
            direction = wasPass && nowBlock ? 'new_block' : 'new_pass';
        }
        deltas.push({
            id: rec.id,
            toolName: rec.toolName,
            serverName: rec.serverName,
            timestamp: rec.timestamp,
            argSource: sample.source,
            baselineAction,
            counterfactualAction,
            changed,
            direction,
            baselineRule: baseline.rule,
            counterfactualRule: counter.rule,
        });
    }
    const newBlocks = deltas.filter((d) => d.direction === 'new_block').length;
    const newPasses = deltas.filter((d) => d.direction === 'new_pass').length;
    const unchanged = deltas.filter((d) => !d.changed).length;
    const fpRiskScore = computeFpRisk(deltas, records);
    const summary = opts.draftRule
        ? `Draft rule "${opts.draftRule.name}": ${newBlocks} new blocks, ${newPasses} new passes, FP risk ${Math.round(fpRiskScore * 100)}%. Args: ${argSources.storedArgs} stored, ${argSources.corpusMatch} corpus, ${argSources.empty} without args.`
        : `Baseline replay: ${records.length} samples (${argSources.storedArgs} with stored args), ${unchanged} unchanged`;
    return {
        generatedAt: new Date().toISOString(),
        windowDays,
        sampleCount: deltas.length,
        newBlocks,
        newPasses,
        unchanged,
        fpRiskScore,
        argSources,
        deltas: deltas.filter((d) => d.changed).slice(0, 100),
        summary,
    };
}
//# sourceMappingURL=policy-counterfactual.js.map