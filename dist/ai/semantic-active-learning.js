import { isCalibratorSeededRecord } from './threat-lab.js';
import { getQuorumConfig, quorumStats } from './learning-quorum.js';
const DEFAULT_MIN = parseFloat(process.env.MASTYF_AI_SEMANTIC_MIN_CONFIDENCE || '0.6');
const DEFAULT_LOCAL = parseFloat(process.env.MASTYF_AI_LOCAL_SEMANTIC_THRESHOLD || '0.55');
function semanticThreshold() {
    const t = parseFloat(process.env.MASTYF_AI_SEMANTIC_MIN_CONFIDENCE || '0.6');
    return Number.isFinite(t) ? t : DEFAULT_MIN;
}
function entropyNearThreshold(confidence, threshold) {
    const dist = Math.abs(confidence - threshold);
    if (dist >= 0.15)
        return 0;
    return 1 - dist / 0.15;
}
function toolRuleNovelty(rec, seen) {
    const key = `${rec.toolName}:${rec.syncDecision?.rule || 'unknown'}`;
    if (seen.has(key))
        return 0;
    seen.add(key);
    return 0.25;
}
export function rankSemanticReviewQueue(records, opts) {
    const limit = opts?.limit ?? 50;
    const threshold = semanticThreshold();
    const seenPairs = new Set();
    const flagged = records.filter((r) => {
        if (!r.semanticAudit?.suspicious)
            return false;
        if (opts?.excludeSeeded !== false && isCalibratorSeededRecord(r))
            return false;
        return true;
    });
    const ranked = flagged.map((rec) => {
        const confidence = rec.semanticAudit.confidence ?? 0;
        const reasons = [];
        let score = 0;
        const nearThreshold = entropyNearThreshold(confidence, threshold);
        if (nearThreshold > 0.5) {
            score += nearThreshold * 0.4;
            reasons.push(`confidence ${confidence.toFixed(2)} near threshold ${threshold}`);
        }
        if (!rec.labeled) {
            score += 0.35;
            reasons.push('unlabeled');
        }
        const syncBlock = rec.syncDecision?.action === 'block';
        const semanticFlag = rec.semanticAudit.suspicious;
        if (syncBlock !== semanticFlag) {
            score += 0.2;
            reasons.push('sync vs semantic disagreement');
        }
        score += toolRuleNovelty(rec, seenPairs);
        if (score > 0 && reasons.length === 1 && reasons[0] === 'unlabeled') {
            reasons.push(`novel tool/rule pair: ${rec.toolName}`);
        }
        return {
            ...rec,
            uncertaintyScore: Math.round(Math.min(1, score) * 1000) / 1000,
            uncertaintyReasons: reasons.length ? reasons : ['baseline review priority'],
        };
    });
    return ranked.sort((a, b) => b.uncertaintyScore - a.uncertaintyScore).slice(0, limit);
}
export function recommendSemanticThresholds(records, quorumLabels) {
    const labeled = records.filter((r) => r.labeled && r.label && !isCalibratorSeededRecord(r));
    const fp = labeled.filter((r) => r.label === 'false_positive').length;
    const tp = labeled.filter((r) => r.label === 'true_positive').length;
    const totalLabeled = labeled.length;
    const fpRate = totalLabeled > 0 ? fp / totalLabeled : 0;
    const currentMin = semanticThreshold();
    const currentLocal = DEFAULT_LOCAL;
    let recommendedMin = currentMin;
    let recommendedLocal = currentLocal;
    let rationale = 'Insufficient labeled data — keep current thresholds';
    if (totalLabeled >= 10) {
        if (fpRate > 0.2) {
            recommendedMin = Math.min(0.95, currentMin + 0.05);
            recommendedLocal = Math.min(0.9, currentLocal + 0.04);
            rationale = `High false-positive rate (${Math.round(fpRate * 100)}%) — raise thresholds`;
        }
        else if (fpRate < 0.05 && tp > fp) {
            recommendedMin = Math.max(0.5, currentMin - 0.03);
            recommendedLocal = Math.max(0.45, currentLocal - 0.02);
            rationale = `Low false-positive rate (${Math.round(fpRate * 100)}%) — consider lowering thresholds`;
        }
        else {
            rationale = `Balanced labels (TP=${tp}, FP=${fp}) — thresholds stable`;
        }
    }
    const cfg = getQuorumConfig();
    let quorumMet = totalLabeled >= cfg.minTotalLabels;
    if (quorumLabels) {
        const entries = Object.values(quorumLabels);
        quorumMet = entries.some((l) => quorumStats(l, cfg).met) || totalLabeled >= cfg.minTotalLabels;
    }
    return {
        currentMinConfidence: currentMin,
        currentLocalThreshold: currentLocal,
        recommendedMinConfidence: Math.round(recommendedMin * 1000) / 1000,
        recommendedLocalThreshold: Math.round(recommendedLocal * 1000) / 1000,
        rationale,
        labeledCount: totalLabeled,
        falsePositiveRate: Math.round(fpRate * 1000) / 1000,
        quorumMet,
        quorumRequired: true,
    };
}
export function buildActiveLearningReport(records) {
    const flagged = records.filter((r) => r.semanticAudit?.suspicious);
    const unlabeled = flagged.filter((r) => !r.labeled);
    return {
        reviewQueue: rankSemanticReviewQueue(records, { limit: 5 }),
        thresholds: recommendSemanticThresholds(records),
        totals: {
            records: records.length,
            flagged: flagged.length,
            unlabeled: unlabeled.length,
        },
    };
}
//# sourceMappingURL=semantic-active-learning.js.map