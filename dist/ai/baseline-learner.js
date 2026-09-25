import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { Logger } from '../utils/logger.js';
import { resolveAiBaselinesPath } from './ai-paths.js';
function minBaselineSamples() {
    const n = parseInt(process.env.MASTYF_AI_AI_MIN_BASELINE_SAMPLES || '3', 10);
    return Number.isFinite(n) && n >= 1 ? n : 3;
}
export class BaselineLearner {
    baselines = new Map();
    defaultZThreshold = 3.0;
    sharedStore = null; // AuditTrailSync for PG-backed persistence
    /** Enable shared PostgreSQL-backed baseline persistence */
    setSharedStore(store) {
        this.sharedStore = store;
    }
    /** Load baselines from shared PG store */
    async loadFromSharedStore() {
        if (!this.sharedStore?.getSharedBaselines)
            return;
        try {
            const rows = await this.sharedStore.getSharedBaselines();
            for (const row of rows) {
                const key = `${row.serverName}:${row.toolName}`;
                if (!this.baselines.has(key)) {
                    this.baselines.set(key, {
                        serverName: row.serverName,
                        toolName: row.toolName,
                        sampleCount: row.sampleCount,
                        avgTokens: row.avgTokens,
                        stddevTokens: row.stddevTokens,
                        avgLatencyMs: row.avgLatencyMs,
                        stddevLatencyMs: row.stddevLatencyMs,
                        hourlyDistribution: Array.isArray(row.hourlyDistribution) ? row.hourlyDistribution : [],
                        argumentKeys: Array.isArray(row.argumentKeys) ? row.argumentKeys : [],
                        firstSeen: row.firstSeen || new Date().toISOString(),
                        lastUpdated: row.lastUpdated || new Date().toISOString(),
                    });
                }
            }
            Logger.info(`[BaselineLearner] Loaded ${rows.length} baselines from shared store`);
        }
        catch (err) {
            Logger.warn(`[BaselineLearner] Shared store load failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** Persist a baseline to shared PG store */
    async persistToShared(baseline) {
        if (!this.sharedStore?.persistBaseline)
            return;
        try {
            await this.sharedStore.persistBaseline({
                serverName: baseline.serverName,
                toolName: baseline.toolName,
                sampleCount: baseline.sampleCount,
                avgTokens: baseline.avgTokens,
                stddevTokens: baseline.stddevTokens,
                avgLatencyMs: baseline.avgLatencyMs,
                stddevLatencyMs: baseline.stddevLatencyMs,
                hourlyDistribution: baseline.hourlyDistribution,
                argumentKeys: baseline.argumentKeys,
                firstSeen: baseline.firstSeen,
                lastUpdated: baseline.lastUpdated,
            });
        }
        catch {
            // Silently fail — persistence is best-effort
        }
    }
    /** Compute or update baselines from call records */
    learn(records) {
        const grouped = new Map();
        for (const r of records) {
            const key = `${r.serverName}:${r.toolName}`;
            if (!grouped.has(key))
                grouped.set(key, []);
            grouped.get(key).push(r);
        }
        for (const [key, recs] of grouped) {
            // Use first record's fields to avoid fragile split (names may contain colons)
            const serverName = recs[0].serverName;
            const toolName = recs[0].toolName;
            const avgT = this.mean(recs.map(r => r.totalTokens));
            const stdT = this.stddev(recs.map(r => r.totalTokens), avgT);
            const avgL = this.mean(recs.map(r => r.durationMs));
            const stdL = this.stddev(recs.map(r => r.durationMs), avgL);
            const hourly = new Array(24).fill(0);
            for (const r of recs) {
                const h = new Date(r.timestamp).getHours();
                if (h >= 0 && h < 24)
                    hourly[h]++;
            }
            // Extract argument key signatures from timestamps (we use first/last range)
            const timestamps = recs.map(r => r.timestamp).sort();
            const firstSeen = timestamps[0] || new Date().toISOString();
            const lastUpdated = timestamps[timestamps.length - 1] || firstSeen;
            const existing = this.baselines.get(key);
            const sampleCount = (existing?.sampleCount || 0) + recs.length;
            this.baselines.set(key, {
                serverName,
                toolName,
                sampleCount,
                avgTokens: avgT,
                stddevTokens: stdT,
                avgLatencyMs: avgL,
                stddevLatencyMs: stdL,
                hourlyDistribution: hourly,
                argumentKeys: existing?.argumentKeys || [],
                firstSeen: existing?.firstSeen || firstSeen,
                lastUpdated,
            });
        }
        // Persist updated baselines to shared store
        for (const [, baseline] of this.baselines) {
            void this.persistToShared(baseline);
        }
        Logger.info(`[BaselineLearner] Learned baselines for ${this.baselines.size} tool/servers`);
    }
    /** Detect deviations in live calls against baselines */
    detectDeviations(live) {
        const key = `${live.serverName}:${live.toolName}`;
        const baseline = this.baselines.get(key);
        if (!baseline || baseline.sampleCount < minBaselineSamples()) {
            return { zScoreTokens: 0, zScoreLatency: 0, isAnomaly: false };
        }
        const zTokens = baseline.stddevTokens > 0
            ? Math.abs(live.totalTokens - baseline.avgTokens) / baseline.stddevTokens
            : 0;
        const zLatency = baseline.stddevLatencyMs > 0
            ? Math.abs(live.durationMs - baseline.avgLatencyMs) / baseline.stddevLatencyMs
            : 0;
        const isAnomaly = zTokens > this.defaultZThreshold || zLatency > this.defaultZThreshold;
        return { zScoreTokens: zTokens, zScoreLatency: zLatency, isAnomaly };
    }
    /** Generate anomaly-based policy rule suggestions */
    suggestRules(records) {
        const suggestions = [];
        const grouped = new Map();
        for (const r of records) {
            const key = `${r.serverName}:${r.toolName}`;
            if (!grouped.has(key))
                grouped.set(key, []);
            grouped.get(key).push(r);
        }
        for (const [key, recs] of grouped) {
            const baseline = this.baselines.get(key);
            if (!baseline || baseline.sampleCount < minBaselineSamples())
                continue;
            const maxToken = Math.max(...recs.map(r => r.totalTokens));
            const zTokens = baseline.stddevTokens > 0
                ? (maxToken - baseline.avgTokens) / baseline.stddevTokens
                : 0;
            if (zTokens > this.defaultZThreshold) {
                const cap = Math.round(baseline.avgTokens + baseline.stddevTokens * 2);
                suggestions.push({
                    rule: {
                        name: `auto-token-cap-${baseline.toolName}`,
                        description: `Auto-generated: ${baseline.toolName} on ${baseline.serverName} averages ${baseline.avgTokens.toFixed(0)} tokens, but spikes detected at ${maxToken}`,
                        action: 'flag',
                        maxTokens: cap,
                    },
                    confidence: Math.min(zTokens / 10, 1.0),
                    reason: `Token spike: mean=${baseline.avgTokens.toFixed(0)}, max=${maxToken}, z=${zTokens.toFixed(2)}`,
                    source: 'baseline',
                });
            }
            // Rate limit suggestion for high-frequency tools
            // Compute rate from actual record span, not baseline.firstSeen (which may be days/weeks old)
            const recTimestamps = recs
                .map(r => new Date(r.timestamp).getTime())
                .filter(t => !isNaN(t))
                .sort((a, b) => a - b);
            const timeSpanMinutes = recTimestamps.length > 1
                ? (recTimestamps[recTimestamps.length - 1] - recTimestamps[0]) / 60000
                : 1;
            const callRate = recs.length / Math.max(1, timeSpanMinutes);
            if (callRate > 60) {
                suggestions.push({
                    rule: {
                        name: `auto-rate-limit-${baseline.toolName}`,
                        description: `Auto-generated: ${baseline.toolName} called ${recs.length} times, rate ~${callRate.toFixed(0)}/min`,
                        action: 'flag',
                        maxCallsPerMinute: Math.round(callRate * 0.8),
                    },
                    confidence: Math.min(callRate / 120, 0.9),
                    reason: `High call rate: ${callRate.toFixed(0)}/min detected`,
                    source: 'baseline',
                });
            }
        }
        return suggestions;
    }
    /**
     * Preventive hardening from stable baselines when no spikes/rate anomalies were found.
     * Surfaces actionable policy ideas so learning cycles are not empty for healthy traffic.
     */
    suggestPreventiveRules(maxSuggestions = 3) {
        const candidates = [...this.baselines.values()]
            .filter(b => b.sampleCount >= minBaselineSamples() && b.avgTokens > 0)
            .sort((a, b) => b.sampleCount - a.sampleCount);
        const suggestions = [];
        for (const baseline of candidates.slice(0, maxSuggestions)) {
            const cap = Math.round(baseline.avgTokens + baseline.stddevTokens * 2);
            suggestions.push({
                rule: {
                    name: `preventive-token-cap-${baseline.serverName}-${baseline.toolName}`,
                    description: `Preventive token cap for ${baseline.toolName} on ${baseline.serverName} (n=${baseline.sampleCount}, mean=${baseline.avgTokens.toFixed(0)} tokens)`,
                    action: 'flag',
                    maxTokens: Math.max(cap, 1),
                },
                confidence: 0.55,
                reason: `Stable baseline: flag calls above ~${cap} tokens (mean=${baseline.avgTokens.toFixed(0)}, σ=${baseline.stddevTokens.toFixed(0)})`,
                source: 'baseline',
            });
        }
        return suggestions;
    }
    getBaseline(key) {
        return this.baselines.get(key);
    }
    getAllBaselines() {
        return [...this.baselines.values()];
    }
    loadFromFile(path) {
        const filePath = path || resolveAiBaselinesPath();
        try {
            if (!existsSync(filePath))
                return 0;
            const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
            if (!Array.isArray(parsed.baselines))
                return 0;
            for (const b of parsed.baselines) {
                const key = `${b.serverName}:${b.toolName}`;
                this.baselines.set(key, b);
            }
            return this.baselines.size;
        }
        catch (err) {
            Logger.warn(`[BaselineLearner] Failed to load baselines: ${err instanceof Error ? err.message : String(err)}`);
            return 0;
        }
    }
    saveToFile(path) {
        const filePath = path || resolveAiBaselinesPath();
        try {
            const dir = dirname(filePath);
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(filePath, JSON.stringify({
                updatedAt: new Date().toISOString(),
                baselines: this.getAllBaselines(),
            }, null, 2));
        }
        catch (err) {
            Logger.warn(`[BaselineLearner] Failed to save baselines: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // ── Internal helpers ──────────────────────────────────────────────────
    mean(values) {
        if (values.length === 0)
            return 0;
        return values.reduce((s, v) => s + v, 0) / values.length;
    }
    stddev(values, mean) {
        if (values.length < 2)
            return 0;
        const m = mean ?? this.mean(values);
        const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
        return Math.sqrt(variance);
    }
}
//# sourceMappingURL=baseline-learner.js.map