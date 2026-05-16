import { ProxyCallRecord } from '../types.js';
import { PolicyDecisionRecord } from './data-collector.js';
import { PolicyRule, PolicyAction } from '../policy/policy-types.js';
import { Logger } from '../utils/logger.js';

export interface BaselineProfile {
  serverName: string;
  toolName: string;
  sampleCount: number;
  avgTokens: number;
  stddevTokens: number;
  avgLatencyMs: number;
  stddevLatencyMs: number;
  /** Hour-of-day distribution — index 0 = midnight hour */
  hourlyDistribution: number[];
  /** Common argument keys seen for this tool */
  argumentKeys: string[];
  /** First seen timestamp */
  firstSeen: string;
  /** Last updated */
  lastUpdated: string;
}

export interface AnomalySuggestion {
  rule: PolicyRule;
  confidence: number;
  reason: string;
  source: 'baseline';
}

export class BaselineLearner {
  private baselines: Map<string, BaselineProfile> = new Map();
  private readonly defaultZThreshold = 3.0;
  private sharedStore: any = null; // AuditTrailSync for PG-backed persistence

  /** Enable shared PostgreSQL-backed baseline persistence */
  setSharedStore(store: any): void {
    this.sharedStore = store;
  }

  /** Load baselines from shared PG store */
  async loadFromSharedStore(): Promise<void> {
    if (!this.sharedStore?.getSharedBaselines) return;
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
    } catch (err: any) {
      Logger.warn(`[BaselineLearner] Shared store load failed: ${err?.message}`);
    }
  }

  /** Persist a baseline to shared PG store */
  private async persistToShared(baseline: BaselineProfile): Promise<void> {
    if (!this.sharedStore?.persistBaseline) return;
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
    } catch {
      // Silently fail — persistence is best-effort
    }
  }

  /** Compute or update baselines from call records */
  learn(records: ProxyCallRecord[]): void {
    const grouped = new Map<string, ProxyCallRecord[]>();
    for (const r of records) {
      const key = `${r.serverName}:${r.toolName}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
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
        if (h >= 0 && h < 24) hourly[h]++;
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
  detectDeviations(
    live: { serverName: string; toolName: string; totalTokens: number; durationMs: number; timestamp: string },
  ): { zScoreTokens: number; zScoreLatency: number; isAnomaly: boolean } {
    const key = `${live.serverName}:${live.toolName}`;
    const baseline = this.baselines.get(key);
    if (!baseline || baseline.sampleCount < 5) {
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
  suggestRules(records: ProxyCallRecord[]): AnomalySuggestion[] {
    const suggestions: AnomalySuggestion[] = [];
    const grouped = new Map<string, ProxyCallRecord[]>();
    for (const r of records) {
      const key = `${r.serverName}:${r.toolName}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }

    for (const [key, recs] of grouped) {
      const baseline = this.baselines.get(key);
      if (!baseline || baseline.sampleCount < 5) continue;

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
            action: 'flag' as PolicyAction,
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
            action: 'flag' as PolicyAction,
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

  getBaseline(key: string): BaselineProfile | undefined {
    return this.baselines.get(key);
  }

  getAllBaselines(): BaselineProfile[] {
    return [...this.baselines.values()];
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  private stddev(values: number[], mean?: number): number {
    if (values.length < 2) return 0;
    const m = mean ?? this.mean(values);
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }
}