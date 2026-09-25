import { createHash } from 'crypto';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
export function getQuorumConfig() {
    const minDistinct = parseInt(process.env.MASTYF_AI_AI_MIN_DISTINCT_LABELERS || '2', 10);
    const minTotal = parseInt(process.env.MASTYF_AI_AI_MIN_TOTAL_LABELS || '10', 10);
    const defaultWeight = parseFloat(process.env.MASTYF_AI_AI_LABEL_WEIGHT || '1');
    const adminUsers = new Set((process.env.MASTYF_AI_AI_ADMIN_USERS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean));
    return {
        minDistinctLabelers: Number.isFinite(minDistinct) && minDistinct >= 1 ? minDistinct : 2,
        minTotalLabels: Number.isFinite(minTotal) && minTotal >= 1 ? minTotal : 10,
        defaultLabelWeight: Number.isFinite(defaultWeight) && defaultWeight > 0 ? defaultWeight : 1,
        adminLabelWeight: 2,
        adminUsers,
        maxLabelsPerHourPerUser: 3,
    };
}
export function learningFingerprint(ruleName, pattern) {
    const material = pattern ? `${ruleName}\0${pattern}` : ruleName;
    return createHash('sha256').update(material).digest('hex').slice(0, 16);
}
export function resolveLabelUserId(userId) {
    return userId?.trim() || process.env.MASTYF_AI_TUI_USER || process.env.USER || 'anonymous';
}
/** Rapid same-user bursts (max 3/hour per fingerprint) count as one effective label. */
export function effectiveLabelWeight(events, userId, cfg) {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const recentSameUser = events.filter((e) => e.userId === userId && new Date(e.ts).getTime() >= hourAgo);
    if (recentSameUser.length > cfg.maxLabelsPerHourPerUser) {
        return 0;
    }
    const base = cfg.adminUsers.has(userId) ? cfg.adminLabelWeight : cfg.defaultLabelWeight;
    return base;
}
export function appendLabelEvent(store, opts) {
    const cfg = getQuorumConfig();
    const fingerprint = learningFingerprint(opts.ruleName, opts.pattern);
    const ts = opts.ts || new Date().toISOString();
    const existing = store[fingerprint] || {
        fingerprint,
        ruleName: opts.ruleName,
        pattern: opts.pattern,
        outcomes: [],
    };
    const weight = effectiveLabelWeight(existing.outcomes, opts.userId, cfg);
    const event = {
        userId: opts.userId,
        accept: opts.accept,
        ts,
        weight: weight > 0 ? weight : 0,
    };
    existing.outcomes.push(event);
    if (existing.outcomes.length > 200) {
        existing.outcomes = existing.outcomes.slice(-200);
    }
    store[fingerprint] = existing;
    return existing;
}
export function quorumStats(labels, cfg = getQuorumConfig()) {
    const active = labels.outcomes.filter((e) => e.weight > 0);
    const distinctLabelers = new Set(active.map((e) => e.userId)).size;
    let weightedAccept = 0;
    let weightedReject = 0;
    for (const e of active) {
        if (e.accept)
            weightedAccept += e.weight;
        else
            weightedReject += e.weight;
    }
    const totalWeighted = weightedAccept + weightedReject;
    const acceptRatio = totalWeighted > 0 ? weightedAccept / totalWeighted : 0;
    const met = distinctLabelers >= cfg.minDistinctLabelers || totalWeighted >= cfg.minTotalLabels;
    return {
        distinctLabelers,
        totalWeighted,
        weightedAccept,
        weightedReject,
        acceptRatio,
        met,
    };
}
export function logQuorumPending(fingerprint, ruleName, stats) {
    StructuredLogger.info({
        event: 'learning_quorum_pending',
        fingerprint,
        ruleName,
        distinctLabelers: stats.distinctLabelers,
        totalWeighted: stats.totalWeighted,
        minDistinct: getQuorumConfig().minDistinctLabelers,
        minTotal: getQuorumConfig().minTotalLabels,
    });
    Logger.debug(`[SelfImprovement] Quorum pending for ${ruleName} (${fingerprint}): ` +
        `${stats.distinctLabelers} labelers, ${stats.totalWeighted} weighted labels`);
}
const DANGEROUS_UNBLOCK = /\b(curl|wget|rm)\b/i;
export function isDangerousUnblockPattern(ruleName, pattern) {
    const hay = `${ruleName} ${pattern || ''}`;
    return DANGEROUS_UNBLOCK.test(hay);
}
export function wouldDisableDangerousBlocking(ruleName, pattern, accept) {
    if (!accept)
        return false;
    return isDangerousUnblockPattern(ruleName, pattern);
}
//# sourceMappingURL=learning-quorum.js.map