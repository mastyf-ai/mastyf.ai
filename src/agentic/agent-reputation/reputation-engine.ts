/** #9 Agent Reputation & Behavior Scoring */
import { IndustryStandardStore } from '../../database/industry-standard-store.js';

export interface AgentReputation {
  agentId: string; score: number; tier: 'trusted' | 'standard' | 'suspicious' | 'blocked';
  totalCalls: number; blockedCalls: number; bypassRate: number; avgArgumentEntropy: number;
  toolDiversity: number; lastUpdated: string; trend: 'improving' | 'stable' | 'declining';
}

type AgentState = {
  total: number; blocked: number; tools: Set<string>; entropySamples: number[];
  scoreHistory: number[];
  biometricAnomalySum: number;
  biometricSamples: number;
  credentialMismatchCount: number;
};

export class ReputationEngine {
  private agents = new Map<string, AgentState>();

  constructor(private readonly store?: IndustryStandardStore) {}

  record(agentId: string, toolName: string, blocked: boolean, argLength: number): void {
    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, {
        total: 0, blocked: 0, tools: new Set(), entropySamples: [], scoreHistory: [],
        biometricAnomalySum: 0, biometricSamples: 0, credentialMismatchCount: 0,
      });
    }
    const a = this.agents.get(agentId)!;
    a.total++;
    if (blocked) a.blocked++;
    a.tools.add(toolName);
    a.entropySamples.push(argLength);
    if (a.entropySamples.length > 200) a.entropySamples = a.entropySamples.slice(-200);
  }

  /** Incorporate A3 biometric anomaly signal into reputation score. */
  recordBiometricSignal(agentId: string, anomalyScore: number, credentialMismatch = false): void {
    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, {
        total: 0, blocked: 0, tools: new Set(), entropySamples: [], scoreHistory: [],
        biometricAnomalySum: 0, biometricSamples: 0, credentialMismatchCount: 0,
      });
    }
    const a = this.agents.get(agentId)!;
    a.biometricAnomalySum += anomalyScore;
    a.biometricSamples++;
    if (credentialMismatch) a.credentialMismatchCount++;
  }

  getScore(agentId: string): AgentReputation {
    const a = this.agents.get(agentId);
    const persisted = this.store?.getAgentReputation(agentId);
    if (!a && persisted) {
      return {
        agentId,
        score: persisted.score / 100,
        tier: persisted.tier as AgentReputation['tier'],
        totalCalls: 0,
        blockedCalls: 0,
        bypassRate: 0,
        avgArgumentEntropy: 0,
        toolDiversity: 0,
        lastUpdated: new Date().toISOString(),
        trend: persisted.trend as AgentReputation['trend'],
      };
    }
    if (!a) {
      return {
        agentId, score: 0.5, tier: 'standard', totalCalls: 0, blockedCalls: 0, bypassRate: 0,
        avgArgumentEntropy: 0, toolDiversity: 0, lastUpdated: new Date().toISOString(), trend: 'stable',
      };
    }

    const bypassRate = a.total > 0 ? (a.total - a.blocked) / a.total : 1;
    const avgLen = a.entropySamples.length > 0 ? a.entropySamples.reduce((s, v) => s + v, 0) / a.entropySamples.length : 0;
    const entropyScore = Math.min(avgLen / 5000, 1);
    const blockPenalty = a.blocked / Math.max(a.total, 1);
    const bioPenalty = a.biometricSamples > 0
      ? (a.biometricAnomalySum / a.biometricSamples) * 0.25
      : 0;
    const credPenalty = a.credentialMismatchCount > 0 ? 0.15 : 0;
    let score = 0.5 + (1 - blockPenalty) * 0.3 - entropyScore * 0.2 - bioPenalty - credPenalty;
    score = Math.max(0, Math.min(1, score));

    a.scoreHistory.push(score);
    if (a.scoreHistory.length > 20) a.scoreHistory = a.scoreHistory.slice(-20);
    const trend = this.computeTrend(a.scoreHistory, persisted?.trend as AgentReputation['trend']);

    let tier: AgentReputation['tier'] = 'standard';
    if (score >= 0.8) tier = 'trusted';
    else if (score < 0.3) tier = 'suspicious';
    else if (a.blocked > 20 && bypassRate < 0.3) tier = 'blocked';

    const rep: AgentReputation = {
      agentId,
      score: Math.round(score * 100) / 100,
      tier,
      totalCalls: a.total,
      blockedCalls: a.blocked,
      bypassRate: Math.round(bypassRate * 100) / 100,
      avgArgumentEntropy: Math.round(avgLen),
      toolDiversity: a.tools.size,
      lastUpdated: new Date().toISOString(),
      trend,
    };

    this.store?.upsertAgentReputation(
      agentId,
      Math.round(score * 100),
      tier,
      trend,
      JSON.stringify({ total: a.total, blocked: a.blocked, tools: [...a.tools] }),
    );

    return rep;
  }

  private computeTrend(history: number[], fallback?: AgentReputation['trend']): AgentReputation['trend'] {
    if (history.length < 3) return fallback ?? 'stable';
    const recent = history.slice(-3);
    const delta = recent[recent.length - 1]! - recent[0]!;
    if (delta > 0.05) return 'improving';
    if (delta < -0.05) return 'declining';
    return 'stable';
  }

  getPolicyForAgent(agentId: string): { mode: 'strict' | 'standard' | 'relaxed'; message: string } {
    const rep = this.getScore(agentId);
    if (rep.tier === 'trusted') return { mode: 'relaxed', message: 'Trusted agent — standard policy' };
    if (rep.tier === 'suspicious' || rep.tier === 'blocked') {
      return { mode: 'strict', message: `${rep.tier} agent — strict policy enforced (read-only, rate-limited)` };
    }
    return { mode: 'standard', message: 'Standard policy applied' };
  }
}
