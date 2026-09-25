import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { resolveAiLearningStatePath } from './ai-paths.js';
import { shouldFreezeThresholdAdjustments } from './drift-detector.js';
import { appendLabelEvent, getQuorumConfig, learningFingerprint, logQuorumPending, quorumStats, resolveLabelUserId, wouldDisableDangerousBlocking, } from './learning-quorum.js';
import { createLearningSnapshot, rollbackLatestSnapshot } from './learning-snapshot.js';
export { resolveAiLearningStatePath } from './ai-paths.js';
const FRESH_STATE = {
    outcomes: [],
    falsePositiveRate: 0,
    truePositiveRate: 0,
    adaptiveThreshold: 0.85,
    moduleWeights: { baseline: 1.0, cost: 1.0, threat: 1.0, assist: 1.0, attack: 1.0 },
    lastUpdated: new Date().toISOString(),
    learningInitialized: false,
    cyclesCompleted: 0,
    recordsAnalyzed: 0,
    baselinesLearned: 0,
    suggestionsGenerated: 0,
    labelFingerprints: {},
    drift: { frozen: false },
};
/**
 * Self-Improvement Engine — reinforcement learning loop that tracks
 * which suggestions are accepted/rejected and adjusts: confidence scoring,
 * auto-apply thresholds, and module trust weights.
 */
export class SelfImprovement {
    state;
    statePath;
    sharedStore = null;
    constructor(statePath, sharedStore) {
        this.statePath = statePath || resolveAiLearningStatePath();
        this.sharedStore = sharedStore || null;
        this.state = this.loadState();
    }
    setSharedStore(store) {
        this.sharedStore = store;
        this.loadSharedState().catch(() => { });
    }
    async loadSharedState() {
        if (!this.sharedStore?.getAggregatedMetrics)
            return;
    }
    loadState() {
        try {
            if (existsSync(this.statePath)) {
                const raw = readFileSync(this.statePath, 'utf-8');
                const parsed = JSON.parse(raw);
                return {
                    ...FRESH_STATE,
                    ...parsed,
                    outcomes: Array.isArray(parsed.outcomes) ? parsed.outcomes.slice(-500) : [],
                    labelFingerprints: parsed.labelFingerprints || {},
                    drift: parsed.drift || { frozen: false },
                    moduleWeights: { ...FRESH_STATE.moduleWeights, ...parsed.moduleWeights },
                };
            }
        }
        catch {
            Logger.info('[SelfImprovement] No prior learning state file');
        }
        return { ...FRESH_STATE, labelFingerprints: {}, drift: { frozen: false } };
    }
    recordCycleComplete(summary) {
        this.state.learningInitialized = true;
        this.state.lastCycleAt = new Date().toISOString();
        this.state.cyclesCompleted = (this.state.cyclesCompleted || 0) + 1;
        this.state.recordsAnalyzed = summary.recordsAnalyzed;
        this.state.baselinesLearned = summary.baselinesLearned;
        this.state.suggestionsGenerated = summary.suggestionsGenerated;
        this.saveState();
        Logger.info(`[SelfImprovement] Cycle #${this.state.cyclesCompleted} persisted: ${summary.recordsAnalyzed} records, ${summary.baselinesLearned} baselines, ${summary.suggestionsGenerated} suggestions`);
    }
    saveState() {
        try {
            const dir = dirname(this.statePath);
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            this.state.lastUpdated = new Date().toISOString();
            writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
        }
        catch (err) {
            Logger.warn(`[SelfImprovement] Failed to save state: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** Record drift report; freezes threshold tuning until MASTYF_AI_AI_DRIFT_OVERRIDE=true. */
    recordDriftReport(report) {
        const wasFrozen = this.state.drift?.frozen;
        if (report.driftDetected) {
            this.state.drift = {
                lastReport: report,
                frozen: true,
                frozenAt: this.state.drift?.frozenAt || new Date().toISOString(),
            };
        }
        else {
            this.state.drift = {
                lastReport: report,
                frozen: wasFrozen ?? false,
                frozenAt: this.state.drift?.frozenAt,
            };
        }
        this.saveState();
    }
    getDriftState() {
        return this.state.drift;
    }
    isThresholdAdjustmentFrozen() {
        return shouldFreezeThresholdAdjustments(this.state.drift);
    }
    /**
     * Record a suggestion outcome. Label events are always stored; weight/threshold
     * changes apply only after quorum (≥2 distinct labelers OR ≥10 weighted labels).
     */
    recordOutcome(outcome, opts) {
        const userId = resolveLabelUserId(opts?.userId || outcome.userId);
        const pattern = opts?.pattern ?? outcome.pattern;
        const fingerprint = outcome.fingerprint || learningFingerprint(outcome.ruleName, pattern);
        const accept = outcome.action === 'applied';
        if (!this.state.labelFingerprints)
            this.state.labelFingerprints = {};
        if (wouldDisableDangerousBlocking(outcome.ruleName, pattern, accept)) {
            const labels = appendLabelEvent(this.state.labelFingerprints, {
                ruleName: outcome.ruleName,
                pattern,
                userId,
                accept,
                ts: outcome.timestamp,
            });
            const stats = quorumStats(labels);
            if (!stats.met) {
                logQuorumPending(fingerprint, outcome.ruleName, stats);
                outcome.quorumApplied = false;
                this.state.outcomes.push({ ...outcome, fingerprint, userId, quorumApplied: false });
                this.trimOutcomes();
                this.saveState();
                Logger.warn(`[SelfImprovement] Blocked dangerous unblock for ${outcome.ruleName} — quorum not met`);
                return { quorumApplied: false };
            }
        }
        appendLabelEvent(this.state.labelFingerprints, {
            ruleName: outcome.ruleName,
            pattern,
            userId,
            accept,
            ts: outcome.timestamp,
        });
        const labels = this.state.labelFingerprints[fingerprint];
        const stats = quorumStats(labels);
        const quorumMet = opts?.skipQuorum === true || stats.met;
        outcome.fingerprint = fingerprint;
        outcome.userId = userId;
        outcome.pattern = pattern;
        outcome.quorumApplied = quorumMet;
        this.state.outcomes.push(outcome);
        this.trimOutcomes();
        if (!quorumMet) {
            logQuorumPending(fingerprint, outcome.ruleName, stats);
            this.saveState();
            Logger.info(`[SelfImprovement] Recorded (quorum pending): ${outcome.ruleName} → ${outcome.action}`);
            return { quorumApplied: false };
        }
        const prevPrecision = this.state.precisionProxy;
        createLearningSnapshot(this.statePath);
        this.recomputeRates();
        this.checkPrecisionRollback(prevPrecision);
        this.saveState();
        Logger.info(`[SelfImprovement] Recorded (quorum applied): ${outcome.ruleName} → ${outcome.action}`);
        return { quorumApplied: true };
    }
    trimOutcomes() {
        if (this.state.outcomes.length > 500) {
            this.state.outcomes = this.state.outcomes.slice(-500);
        }
    }
    computePrecisionProxy() {
        const labeled = this.state.outcomes.filter((o) => o.quorumApplied && (o.action === 'applied' || o.action === 'rejected'));
        if (labeled.length < 5)
            return undefined;
        const recent = labeled.slice(-50);
        const applied = recent.filter((o) => o.action === 'applied').length;
        return applied / recent.length;
    }
    checkPrecisionRollback(prevPrecision) {
        const current = this.computePrecisionProxy();
        if (current === undefined)
            return;
        this.state.lastPrecisionProxy = prevPrecision;
        this.state.precisionProxy = current;
        if (prevPrecision !== undefined &&
            prevPrecision - current > 0.1) {
            StructuredLogger.info({
                event: 'ai_learning_auto_rollback',
                prevPrecision,
                currentPrecision: current,
                drop: prevPrecision - current,
            });
            Logger.error(`[SelfImprovement] Precision proxy dropped ${((prevPrecision - current) * 100).toFixed(1)}% — auto-rollback`);
            rollbackLatestSnapshot(this.statePath);
            this.state = this.loadState();
        }
    }
    recomputeRates() {
        if (this.isThresholdAdjustmentFrozen()) {
            Logger.debug('[SelfImprovement] Threshold adjustments frozen (drift detected)');
            return;
        }
        const recent = this.state.outcomes.filter((o) => o.quorumApplied !== false).slice(-100);
        if (recent.length < 5)
            return;
        const applied = recent.filter((o) => o.action === 'applied').length;
        const rejected = recent.filter((o) => o.action === 'rejected').length;
        const total = applied + rejected || 1;
        this.state.truePositiveRate = applied / total;
        this.state.falsePositiveRate = rejected / total;
        if (this.state.truePositiveRate > 0.9) {
            this.state.adaptiveThreshold = Math.max(0.5, this.state.adaptiveThreshold - 0.02);
        }
        else if (this.state.falsePositiveRate > 0.3) {
            this.state.adaptiveThreshold = Math.min(0.95, this.state.adaptiveThreshold + 0.05);
        }
        for (const source of ['baseline', 'cost', 'threat', 'assist', 'attack']) {
            const moduleOutcomes = recent.filter((o) => o.source === source);
            if (moduleOutcomes.length >= 3) {
                const accepted = moduleOutcomes.filter((o) => o.action === 'applied').length;
                const accuracy = accepted / moduleOutcomes.length;
                this.state.moduleWeights[source] = 0.5 + accuracy * 0.5;
            }
        }
    }
    /** Manual rollback to previous learning snapshot. */
    rollback() {
        const result = rollbackLatestSnapshot(this.statePath);
        if (result.ok) {
            this.state = this.loadState();
        }
        return result;
    }
    adjustConfidence(rawConfidence, source) {
        const weight = this.state.moduleWeights[source] || 1.0;
        return Math.min(rawConfidence * weight, 1.0);
    }
    getAdaptiveThreshold() {
        return this.state.adaptiveThreshold;
    }
    suggestPruning() {
        const pruneList = [];
        const ruleCounts = new Map();
        for (const o of this.state.outcomes) {
            if (o.quorumApplied === false)
                continue;
            if (!ruleCounts.has(o.ruleName))
                ruleCounts.set(o.ruleName, { applied: 0, rejected: 0 });
            const c = ruleCounts.get(o.ruleName);
            if (o.action === 'applied')
                c.applied++;
            if (o.action === 'rejected')
                c.rejected++;
        }
        for (const [ruleName, counts] of ruleCounts) {
            if (counts.rejected > counts.applied * 3 && counts.rejected >= 5) {
                pruneList.push(ruleName);
            }
        }
        return pruneList;
    }
    getState() {
        return { ...this.state };
    }
    getQuorumConfig() {
        return getQuorumConfig();
    }
}
//# sourceMappingURL=self-improvement.js.map