import { ProxyCallRecord } from '../types.js';
import { PolicyRule, PolicyAction } from '../policy/policy-types.js';
import { CostAuditor } from '../services/cost-auditor.js';
import { HistoryDatabase } from '../database/history-db.js';
import { Logger } from '../utils/logger.js';

export interface CostPattern {
  toolName: string;
  serverName: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  costPercentOfTotal: number;
  tokenTrend: 'increasing' | 'flat' | 'decreasing';
}

export interface CostSuggestion {
  rule: PolicyRule;
  confidence: number;
  reason: string;
  estimatedSavings: number;
  source: 'cost';
}

export class CostOptimizer {
  private db: HistoryDatabase;
  private costAuditor: CostAuditor;
  private budgetCap: number;

  constructor(db: HistoryDatabase, costAuditor: CostAuditor, budgetCap?: number) {
    this.db = db;
    this.costAuditor = costAuditor;
    this.budgetCap = budgetCap ?? parseFloat(process.env['MCP_GUARDIAN_COST_BUDGET'] || '0');
  }

  /** Analyze cost patterns from call records with pricing awareness */
  async analyzePatterns(records: ProxyCallRecord[], inputPricePerM: number, outputPricePerM: number): Promise<CostPattern[]> {
    const grouped = new Map<string, { records: ProxyCallRecord[]; serverName: string; toolName: string }>();
    for (const r of records) {
      const key = `${r.serverName}:${r.toolName}`;
      if (!grouped.has(key)) {
        grouped.set(key, { records: [], serverName: r.serverName, toolName: r.toolName });
      }
      grouped.get(key)!.records.push(r);
    }

    let totalCost = 0;
    const patterns: CostPattern[] = [];

    for (const [, group] of grouped) {
      const inputTokens = group.records.reduce((s, r) => s + r.requestTokens, 0);
      const outputTokens = group.records.reduce((s, r) => s + r.responseTokens, 0);
      const cost = (inputTokens * inputPricePerM + outputTokens * outputPricePerM) / 1_000_000;
      totalCost += cost;

      // Token trend detection (compare first half vs second half)
      const half = Math.ceil(group.records.length / 2);
      const firstHalf = group.records.slice(0, half);
      const secondHalf = group.records.slice(half);
      const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, r) => s + r.totalTokens, 0) / firstHalf.length : 0;
      const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, r) => s + r.totalTokens, 0) / secondHalf.length : 0;
      const ratio = firstAvg > 0 ? secondAvg / firstAvg : 1;
      const trend: 'increasing' | 'flat' | 'decreasing' = ratio > 1.3 ? 'increasing' : ratio < 0.7 ? 'decreasing' : 'flat';

      patterns.push({
        toolName: group.toolName,
        serverName: group.serverName,
        totalCost: cost,
        inputTokens,
        outputTokens,
        callCount: group.records.length,
        costPercentOfTotal: 0, // filled after total calculation
        tokenTrend: trend,
      });
    }

    // Fill percentages
    for (const p of patterns) {
      p.costPercentOfTotal = totalCost > 0 ? (p.totalCost / totalCost) * 100 : 0;
    }

    // Sort by cost descending
    patterns.sort((a, b) => b.totalCost - a.totalCost);

    return patterns;
  }

  /** Detect burst patterns — tools with high variance in call frequency */
  async detectBurstPatterns(records: ProxyCallRecord[]): Promise<Map<string, number>> {
    const bursty = new Map<string, number>();
    const callsPerBucket = new Map<string, Map<number, number>>();

    for (const r of records) {
      const key = `${r.serverName}:${r.toolName}`;
      if (!callsPerBucket.has(key)) callsPerBucket.set(key, new Map());
      // Bucket by 1-minute intervals and count calls per bucket
      const minuteBucket = Math.floor(new Date(r.timestamp).getTime() / 60000);
      const buckets = callsPerBucket.get(key)!;
      buckets.set(minuteBucket, (buckets.get(minuteBucket) || 0) + 1);
    }

    // Find peak call count for each tool
    for (const [key, buckets] of callsPerBucket) {
      const peakCount = Math.max(...buckets.values());
      if (peakCount > 1) {
        bursty.set(key, peakCount);
      }
    }

    return bursty;
  }

  /** Generate cost-optimization policy suggestions */
  suggestRules(patterns: CostPattern[], burstMap?: Map<string, number>): CostSuggestion[] {
    const suggestions: CostSuggestion[] = [];

    for (const p of patterns) {
      // Token budget suggestion for expensive tools
      if (p.costPercentOfTotal > 30 && p.callCount > 0) {
        const avgTokens = (p.inputTokens + p.outputTokens) / p.callCount;
        const suggestedCap = Math.round(avgTokens * 0.8);
        suggestions.push({
          rule: {
            name: `cost-optimize-${p.toolName}`,
            description: `Auto-generated: ${p.toolName} consumes ${p.costPercentOfTotal.toFixed(1)}% of total cost ($${p.totalCost.toFixed(4)})`,
            action: 'flag' as PolicyAction,
            maxTokens: suggestedCap > 0 ? suggestedCap : 1000,
          },
          confidence: Math.min(p.costPercentOfTotal / 50, 0.9),
          reason: `High-cost tool: ${p.costPercentOfTotal.toFixed(1)}% of budget, trend: ${p.tokenTrend}`,
          estimatedSavings: p.totalCost * 0.2, // expected 20% savings from token cap
          source: 'cost',
        });
      }

      // Rate limit for bursty tools
      if (burstMap?.has(`${p.serverName}:${p.toolName}`)) {
        const burstCount = burstMap.get(`${p.serverName}:${p.toolName}`)!;
        if (burstCount > 10) {
          suggestions.push({
            rule: {
              name: `cost-burst-${p.toolName}`,
              description: `Auto-generated: ${p.toolName} shows burst usage (${burstCount} calls/min peak)`,
              action: 'flag' as PolicyAction,
              maxCallsPerMinute: Math.max(Math.round(burstCount * 0.5), 5),
            },
            confidence: Math.min(burstCount / 30, 0.85),
            reason: `Burst pattern detected: ${burstCount} calls/min peak`,
            estimatedSavings: p.totalCost * 0.15,
            source: 'cost',
          });
        }
      }

      // Budget cap warning
      if (this.budgetCap > 0 && p.totalCost > this.budgetCap * 0.5) {
        suggestions.push({
          rule: {
            name: `cost-budget-${p.toolName}`,
            description: `Auto-generated: ${p.toolName} exceeds 50% of daily budget ($${this.budgetCap.toFixed(2)})`,
            action: 'block' as PolicyAction,
            // Budget cap is a daily limit; compute per-minute rate from 24h window
            maxCallsPerMinute: Math.max(Math.round(p.callCount * 0.3 / (24 * 60)), 1),
          },
          confidence: Math.min(p.totalCost / this.budgetCap, 0.95),
          reason: `Budget warning: ${p.costPercentOfTotal.toFixed(1)}% of $${this.budgetCap.toFixed(2)} daily cap`,
          estimatedSavings: p.totalCost * 0.5,
          source: 'cost',
        });
      }
    }

    return suggestions;
  }

  setBudgetCap(cap: number): void {
    this.budgetCap = cap;
  }

  getBudgetCap(): number {
    return this.budgetCap;
  }
}