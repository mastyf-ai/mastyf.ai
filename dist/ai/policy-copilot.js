/**
 * Policy Copilot — NL → YAML with mandatory corpus + blocked-history replay before stage-for-review.
 */
import { readFileSync, existsSync } from 'fs';
import { load } from 'js-yaml';
import { PolicyAssist } from './policy-assist.js';
import { loadCorpusSamples, validatePolicyRuleSafe } from './threat-lab.js';
import { loadSemanticAuditRecordsAsync } from './semantic-audit-store.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { Logger } from '../utils/logger.js';
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
function buildEngineWithDraftRule(draftRule, policyPath) {
    const config = loadPolicyConfig(policyPath);
    if (!config?.policy?.rules)
        return null;
    const merged = {
        ...config,
        policy: {
            ...config.policy,
            mode: 'block',
            rules: [draftRule, ...config.policy.rules],
        },
    };
    return new PolicyEngine(merged);
}
function evalSample(engine, draftRuleName, sample) {
    const ctx = {
        serverName: sample.serverName || 'policy-copilot',
        toolName: sample.toolName,
        arguments: sample.arguments,
        requestId: `copilot-${Date.now()}`,
        requestTokens: 50,
        timestamp: new Date().toISOString(),
    };
    const decision = engine.evaluate(ctx);
    return {
        action: decision.action,
        rule: decision.rule,
        matchedDraft: decision.rule === draftRuleName,
    };
}
export function replayDraftRule(draftRule, opts) {
    const engine = buildEngineWithDraftRule(draftRule, opts?.policyPath);
    if (!engine) {
        return {
            total: 0,
            passed: 0,
            failed: 0,
            results: [],
            readyForReview: false,
            blockReason: 'Policy file not found or invalid',
        };
    }
    const results = [];
    const corpus = loadCorpusSamples({ limit: opts?.corpusLimit ?? 40 });
    for (const c of corpus) {
        const ev = evalSample(engine, draftRule.name, {
            toolName: c.toolName,
            arguments: (c.arguments ?? {}),
        });
        const expected = c.expected === 'pass' ? 'pass' : 'block';
        const actual = ev.action;
        const ok = expected === 'block'
            ? actual === 'block' || actual === 'flag'
            : actual === 'pass';
        results.push({
            id: c.id || c.relPath,
            source: 'corpus',
            toolName: c.toolName,
            expected,
            actual,
            rule: ev.rule,
            matchedDraft: ev.matchedDraft,
            ok,
        });
    }
    return finalizeReplayMatrix(draftRule, results);
}
export async function replayDraftRuleAsync(draftRule, opts) {
    const engine = buildEngineWithDraftRule(draftRule, opts?.policyPath);
    if (!engine) {
        return {
            total: 0,
            passed: 0,
            failed: 0,
            results: [],
            readyForReview: false,
            blockReason: 'Policy file not found or invalid',
        };
    }
    const results = [];
    const corpus = loadCorpusSamples({ limit: opts?.corpusLimit ?? 40 });
    for (const c of corpus) {
        const ev = evalSample(engine, draftRule.name, {
            toolName: c.toolName,
            arguments: (c.arguments ?? {}),
        });
        const expected = c.expected === 'pass' ? 'pass' : 'block';
        const actual = ev.action;
        const ok = expected === 'block'
            ? actual === 'block' || actual === 'flag'
            : actual === 'pass';
        results.push({
            id: c.id || c.relPath,
            source: 'corpus',
            toolName: c.toolName,
            expected,
            actual,
            rule: ev.rule,
            matchedDraft: ev.matchedDraft,
            ok,
        });
    }
    const historyLimit = opts?.historyLimit ?? 15;
    const records = await loadSemanticAuditRecordsAsync({
        tenantId: opts?.tenantId,
        sinceMs: 14 * 24 * 60 * 60 * 1000,
        limit: 200,
    });
    const blocked = records
        .filter((r) => r.syncDecision?.action === 'block' || r.semanticAudit?.suspicious)
        .slice(-historyLimit);
    for (const r of blocked) {
        const sample = (await import('./counterfactual-replay-source.js')).resolveReplaySample(r);
        const ev = evalSample(engine, draftRule.name, {
            toolName: sample.toolName,
            arguments: sample.arguments,
            serverName: sample.serverName,
        });
        results.push({
            id: r.id,
            source: 'history',
            toolName: r.toolName,
            expected: 'unknown',
            actual: ev.action,
            rule: ev.rule,
            matchedDraft: ev.matchedDraft,
            ok: true,
        });
    }
    return finalizeReplayMatrix(draftRule, results);
}
function finalizeReplayMatrix(draftRule, results) {
    const corpusResults = results.filter((r) => r.source === 'corpus');
    const failed = corpusResults.filter((r) => !r.ok).length;
    const passed = corpusResults.filter((r) => r.ok).length;
    const validationErrors = validatePolicyRuleSafe(draftRule);
    const blockFixtures = corpusResults.filter((r) => r.expected === 'block');
    const blockFixturesOk = blockFixtures.filter((r) => r.ok).length;
    const passFixtures = corpusResults.filter((r) => r.expected === 'pass');
    const passFixturesOk = passFixtures.filter((r) => r.ok).length;
    let readyForReview = validationErrors.length === 0 && corpusResults.length > 0;
    let blockReason;
    if (validationErrors.length > 0) {
        readyForReview = false;
        blockReason = validationErrors.join('; ');
    }
    else if (blockFixtures.length > 0 && blockFixturesOk < Math.ceil(blockFixtures.length * 0.5)) {
        readyForReview = false;
        blockReason = 'Draft rule blocks fewer than 50% of corpus attack fixtures';
    }
    else if (passFixtures.length > 0 && passFixturesOk < passFixtures.length) {
        readyForReview = false;
        blockReason = 'Draft rule incorrectly blocks corpus pass fixtures';
    }
    return {
        total: results.length,
        passed: passed + results.filter((r) => r.source === 'history').length,
        failed,
        results,
        readyForReview,
        blockReason,
    };
}
export async function generatePolicyCopilotSuggestion(goal, opts) {
    const assist = new PolicyAssist();
    const suggestion = await assist.generateRuleWithLLM(goal, opts?.availableTools);
    if (!suggestion)
        return null;
    const yaml = assist.toYAML(suggestion.rule);
    const validationErrors = validatePolicyRuleSafe(suggestion.rule);
    const replay = opts?.skipReplay
        ? { total: 0, passed: 0, failed: 0, results: [], readyForReview: validationErrors.length === 0 }
        : await replayDraftRuleAsync(suggestion.rule, {
            policyPath: opts?.policyPath,
            tenantId: opts?.tenantId,
        });
    Logger.info(`[PolicyCopilot] Generated rule "${suggestion.rule.name}" — replay ${replay.passed}/${replay.total} ok, staged=${replay.readyForReview}`);
    return {
        goal,
        rule: suggestion.rule,
        yaml,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        validationErrors,
        replay,
        staged: replay.readyForReview,
    };
}
//# sourceMappingURL=policy-copilot.js.map