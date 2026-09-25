import { loadSemanticAuditRecordsAsync } from '../ai/semantic-audit-store.js';
import { loadAllRecordsInWindow } from './cost-timeseries.js';
import { parsePolicyConfig } from '../policy/policy-schema.js';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
export async function resolveMonitorThreatContext(row, tenantId, db) {
    if (row.threatKey.startsWith('semantic:')) {
        const semanticId = row.threatKey.slice('semantic:'.length);
        const records = await loadSemanticAuditRecordsAsync({ limit: 2000, tenantId, sinceMs: 30 * 24 * 60 * 60 * 1000 });
        const semantic = records.find((r) => r.id === semanticId);
        if (semantic)
            return { sourceKind: 'semantic', row, semantic };
        return { sourceKind: 'unknown', row };
    }
    if (row.threatKey.startsWith('block:') && db) {
        const parts = row.threatKey.split(':');
        const serverName = parts[1] || '';
        const toolName = parts[2] || '';
        const timestamp = parts.slice(3).join(':');
        const records = await loadAllRecordsInWindow(db, tenantId, 7);
        const match = records.find((r) => r.serverName === serverName
            && r.toolName === toolName
            && String(r.timestamp || '') === timestamp);
        if (match)
            return { sourceKind: 'block', row, record: match };
        return { sourceKind: 'unknown', row };
    }
    return { sourceKind: 'unknown', row };
}
export function buildQuarantineRule(context) {
    if (context.sourceKind === 'semantic') {
        const tool = context.semantic.toolName || context.row.type;
        const args = JSON.stringify(context.semantic.argumentsSnapshot || {}).slice(0, 160);
        const pattern = args ? args.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : 'prompt|injection|override|bypass';
        return {
            rule: {
                name: `quarantine-semantic-${context.semantic.id.slice(0, 12)}`,
                description: `[QUARANTINE] Reinforce semantic threat ${context.row.id} from monitor`,
                action: 'block',
                tools: { allow: [tool] },
                patterns: [pattern],
            },
            confidence: 0.95,
            detail: 'Built semantic quarantine rule from audit context',
        };
    }
    if (context.sourceKind === 'block') {
        const record = context.record;
        const existingPattern = (record.blockReason || '').trim();
        return {
            rule: {
                name: `quarantine-block-${context.row.id.toLowerCase()}`,
                description: `[QUARANTINE] Reinforce blocked monitor threat ${context.row.id}`,
                action: 'block',
                tools: { allow: [record.toolName] },
                patterns: [existingPattern || record.blockRule || context.row.type],
            },
            confidence: 0.9,
            detail: 'Built block quarantine rule from history record',
        };
    }
    return {
        rule: null,
        confidence: 0.5,
        detail: 'No semantic/block context found for threatKey',
    };
}
function ruleAlreadyInPolicy(rule, policyPath) {
    try {
        const yaml = readFileSync(policyPath, 'utf-8');
        const config = parsePolicyConfig(load(yaml));
        return config.policy.rules.some((r) => r.name === rule.name);
    }
    catch {
        return false;
    }
}
export async function applyMonitorQuarantineEnforcement(opts) {
    const context = await resolveMonitorThreatContext(opts.row, opts.tenantId, opts.db);
    const built = buildQuarantineRule(context);
    if (!built.rule) {
        return { status: 'no_context', sourceKind: context.sourceKind, detail: built.detail };
    }
    if (opts.row.status === 'blocked') {
        return {
            status: 'already_blocked',
            sourceKind: context.sourceKind,
            appliedRuleName: built.rule.name,
            policyPath: opts.policyPath,
            detail: 'Threat already blocked in monitor',
        };
    }
    if (ruleAlreadyInPolicy(built.rule, opts.policyPath)) {
        return {
            status: 'already_present',
            sourceKind: context.sourceKind,
            appliedRuleName: built.rule.name,
            policyPath: opts.policyPath,
            detail: 'Rule already exists in policy',
        };
    }
    const { recordSuggestionOutcome } = await import('../ai/suggestion-engine.js');
    await recordSuggestionOutcome(`monitor-quarantine:${opts.row.threatKey}`, 'applied', {
        ruleName: built.rule.name,
        source: 'threat',
        confidence: built.confidence,
        rule: built.rule,
        policyPath: opts.policyPath,
        policyWatcher: opts.policyWatcher,
        userId: opts.operator,
    });
    return {
        status: 'applied',
        sourceKind: context.sourceKind,
        appliedRuleName: built.rule.name,
        policyPath: opts.policyPath,
        detail: built.detail,
    };
}
//# sourceMappingURL=monitor-quarantine-enforcement.js.map