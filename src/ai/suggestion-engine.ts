import { DataCollector, GovernanceSnapshot, registerDataCollector, recordPolicyDecisionGlobal } from './data-collector.js';
import { learnAttackPatterns, attackMinConfidence } from './attack-pattern-learner.js';
import { BaselineLearner, AnomalySuggestion } from './baseline-learner.js';
import { CostOptimizer, CostSuggestion } from './cost-optimizer.js';
import { ThreatIntel, ThreatSuggestion } from './threat-intel.js';
import { PolicyAssist, AssistSuggestion } from './policy-assist.js';
import { PatternRecognizer, CrossLayerInsight } from './pattern-recognizer.js';
import { SelfImprovement, LearningOutcome } from './self-improvement.js';
import { detectDrift } from './drift-detector.js';
import { createLearningSnapshot } from './learning-snapshot.js';
import { wouldDisableDangerousBlocking } from './learning-quorum.js';
import { ComprehensiveReporter, ComprehensiveReport } from './comprehensive-reporter.js';
import { PolicyRule } from '../policy/policy-types.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import type { McpServerConfig } from '../types.js';
import { PricingClient } from '../clients/pricing-client.js';
import { Logger } from '../utils/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { resolveAiPendingSuggestionsPath, resolveAiReportPath } from './ai-paths.js';
import { broadcastDashboardEvent } from '../utils/dashboard-events.js';
import { isAiAutoApplyEnabled, isAiLearningEnabled, isAiLearningOnCliCommands } from '../utils/ai-enabled.js';
import { getAllActiveServerNames } from '../utils/db-aggregate.js';
import { HistoryDatabase } from '../database/history-db.js';
import { getLlmConfig } from '../config/llm-config.js';
import { scorePolicyImpact } from './policy-impact-scoring.js';
import { evaluateAutopilotSafety } from './autopilot-safety-contract.js';

export interface UnifiedSuggestion {
  id: string;
  rule: PolicyRule;
  confidence: number;
  reason: string;
  source: 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern' | 'attack';
  estimatedSavings?: number;
  autopilot?: {
    safetyAllowed: boolean;
    safetyBlockers: string[];
    impactOverall: number;
    recommendation: 'promote' | 'canary_only' | 'hold';
  };
}

export interface SuggestionEngineConfig {
  autoApplyThreshold: number;
  enabledModules: ('baseline' | 'cost' | 'threat' | 'assist' | 'pattern')[];
  policyOutputPath: string;
  analysisIntervalMs: number;
}

const DEFAULT_CONFIG: SuggestionEngineConfig = {
  autoApplyThreshold: 0.85,
  enabledModules: ['baseline', 'cost', 'threat', 'assist', 'pattern'],
  policyOutputPath: './default-policy-auto-generated.yaml',
  analysisIntervalMs: 15 * 60 * 1000, // 15 minutes
};

let suggestionCounter = 0;

export class SuggestionEngine {
  private collector: DataCollector;
  private baselineLearner: BaselineLearner;
  private costOptimizer: CostOptimizer;
  private threatIntel: ThreatIntel;
  private policyAssist: PolicyAssist;
  private patternRecognizer: PatternRecognizer;
  private selfImprovement: SelfImprovement;
  private reporter: ComprehensiveReporter;
  private config: SuggestionEngineConfig;
  private servers: McpServerConfig[] = [];
  private analysisTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    collector: DataCollector,
    baselineLearner: BaselineLearner,
    costOptimizer: CostOptimizer,
    threatIntel: ThreatIntel,
    policyAssist: PolicyAssist,
    patternRecognizer: PatternRecognizer,
    selfImprovement: SelfImprovement,
    config?: Partial<SuggestionEngineConfig>,
  ) {
    this.collector = collector;
    this.baselineLearner = baselineLearner;
    this.costOptimizer = costOptimizer;
    this.threatIntel = threatIntel;
    this.policyAssist = policyAssist;
    this.patternRecognizer = patternRecognizer;
    this.selfImprovement = selfImprovement;
    this.reporter = new ComprehensiveReporter();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Set the server list for analysis context */
  setServers(servers: McpServerConfig[]): void {
    this.servers = servers;
  }

  /**
   * Run a full analysis cycle: collect → analyze → suggest → score → filter → auto-apply → learn.
   */
  async runLearningCycle(): Promise<{
    suggestions: UnifiedSuggestion[];
    autoApplied: UnifiedSuggestion[];
    insights: CrossLayerInsight[];
    report: ComprehensiveReport;
  }> {
    // ── 1. Collect all governance data ───────────────────
    const snapshot = await this.collector.collectAll(this.servers);

    // ── 2. Learn baselines ──────────────────────────────
    if (snapshot.callRecords.length > 0) {
      this.baselineLearner.learn(snapshot.callRecords);
    }

    // ── 3. Run all suggestion modules ───────────────────
    const allSuggestions: UnifiedSuggestion[] = [];

    if (this.config.enabledModules.includes('baseline')) {
      const anomalySuggestions = this.baselineLearner.suggestRules(snapshot.callRecords);
      const preventiveSuggestions =
        anomalySuggestions.length === 0
          ? this.baselineLearner.suggestPreventiveRules(3)
          : [];
      for (const s of [...anomalySuggestions, ...preventiveSuggestions]) {
        allSuggestions.push(this.toUnified(s));
      }
    }

    const blockedRecords = snapshot.callRecords.filter((r) => r.blocked);
    if (blockedRecords.length > 0) {
      const attackSuggestions = learnAttackPatterns(blockedRecords);
      for (const s of attackSuggestions) {
        allSuggestions.push({
          id: `attack-${suggestionCounter++}`,
          rule: s.rule,
          confidence: this.selfImprovement.adjustConfidence(s.confidence, 'attack'),
          reason: s.reason,
          source: 'attack',
        });
      }
    }

    if (this.config.enabledModules.includes('cost')) {
      // Use live PricingClient for per-model token prices
      const pricingClient = new PricingClient();
      // Sample the first few records to determine dominant model
      const modelCounts = new Map<string, number>();
      const defaultModel = getLlmConfig().model;
      for (const r of snapshot.callRecords.slice(0, 50)) {
        const model = (r as { model?: string }).model || defaultModel;
        modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
      }
      let dominantModel = defaultModel;
      let maxCount = 0;
      for (const [model, count] of modelCounts) {
        if (count > maxCount) { maxCount = count; dominantModel = model; }
      }
      const livePricing = await pricingClient.getModelPricing(dominantModel);
      const inputPrice = (livePricing?.input ?? 2.50) / 1_000_000;
      const outputPrice = (livePricing?.output ?? 10.00) / 1_000_000;

      const patterns = await this.costOptimizer.analyzePatterns(snapshot.callRecords, inputPrice, outputPrice);
      const burstMap = await this.costOptimizer.detectBurstPatterns(snapshot.callRecords);
      const costSuggestions = this.costOptimizer.suggestRules(patterns, burstMap);
      for (const s of costSuggestions) {
        allSuggestions.push({
          id: `cost-${suggestionCounter++}`,
          rule: s.rule,
          confidence: s.confidence,
          reason: s.reason,
          source: 'cost',
          estimatedSavings: s.estimatedSavings,
        });
      }
    }

    // Threat intel — poll live feeds, optionally LLM-enrich before rule generation
    if (this.config.enabledModules.includes('threat')) {
      try {
        await this.threatIntel.pollLiveFeeds();
      } catch {
        /* best-effort poll */
      }
      const catalog = this.threatIntel.getCatalogEntries({ minSeverity: 'MEDIUM', limit: 20 });
      const llmEnrich = process.env.MASTYF_AI_AI_THREAT_LLM !== 'false';
      let llm: import('./llm-assistant.js').LlmAssistant | null = null;
      if (llmEnrich) {
        const { LlmAssistant } = await import('./llm-assistant.js');
        const assistant = new LlmAssistant();
        if (assistant.isAvailable() && (await assistant.healthCheck())) {
          llm = assistant;
        }
      }
      for (const entry of catalog) {
        let suggestions = this.threatIntel.generateRules([entry]);
        if (llm) {
          const analysis = await llm.analyzeThreat({
            cveId: entry.id.replace(/^nvd-/, ''),
            severity: entry.severity,
            description: entry.description,
            affectedPackage: entry.affectedPackage || 'unknown',
          });
          if (analysis?.suggestedPatterns?.length) {
            suggestions = [
              {
                rule: {
                  name: `threat-llm-${entry.id}`,
                  description: `[${entry.severity}] ${analysis.impact || entry.description.slice(0, 120)}`,
                  action: analysis.action === 'pass' ? 'flag' : 'block',
                  patterns: analysis.suggestedPatterns.slice(0, 3),
                },
                confidence:
                  entry.severity === 'CRITICAL' ? 0.9 : entry.severity === 'HIGH' ? 0.85 : 0.75,
                reason: `LLM-enriched ${entry.severity} threat from ${entry.source}`,
                source: 'threat' as const,
                entry,
              },
            ];
          }
        }
        for (const s of suggestions) {
          allSuggestions.push({
            id: `threat-${suggestionCounter++}`,
            rule: s.rule,
            confidence: this.selfImprovement.adjustConfidence(s.confidence, 'threat'),
            reason: s.reason,
            source: 'threat',
          });
        }
      }
    }

    // Note: policy-assist requires NL goals; call generateRule() externally

    // ── 4. Pattern recognition ──────────────────────────
    const insights = this.patternRecognizer.analyze(snapshot);
    const temporal = this.patternRecognizer.detectTemporalPatterns(snapshot);

    // Add pattern-based suggestions
    if (this.config.enabledModules.includes('pattern')) {
      for (const i of insights) {
        if (i.suggestedRule) {
          allSuggestions.push({
            id: `pattern-${suggestionCounter++}`,
            rule: i.suggestedRule,
            confidence: i.confidence,
            reason: i.description,
            source: 'pattern',
          });
        }
      }
    }

    // ── 5. Drift detection (7d vs prior 7d per server:tool) ──
    const learningState = this.selfImprovement.getState();
    const driftReport = detectDrift(snapshot.callRecords, {
      labeledFpRateRecent: learningState.falsePositiveRate,
      labeledFpRatePrior: learningState.lastPrecisionProxy,
    });
    this.selfImprovement.recordDriftReport(driftReport);

    // ── 6. Adjust confidence via self-improvement ────────
    for (const s of allSuggestions) {
      s.confidence = this.selfImprovement.adjustConfidence(s.confidence, s.source);
      const impact = scorePolicyImpact({
        confidence: s.confidence,
        replayCoverage: Math.max(0.6, Math.min(1, 0.7 + (s.confidence * 0.3))),
        predictedFalsePositiveDelta: s.source === 'cost' ? 0.01 : 0.005,
        predictedBypassDelta: s.source === 'threat' || s.source === 'attack' ? 0 : 0.002,
        blastRadiusPercent: s.source === 'threat' ? 0.04 : 0.08,
        rollbackConfidence: Math.max(0.75, Math.min(0.99, 0.7 + (s.confidence * 0.3))),
      });
      const safety = evaluateAutopilotSafety({
        suggestionId: s.id,
        source: s.source,
        stage: impact.recommendation === 'promote' ? 'enforce' : 'canary',
        rule: s.rule,
        evidence: {
          simulationPassed: impact.recommendation !== 'hold',
          replayCoverage: Math.max(0.6, Math.min(1, 0.7 + (s.confidence * 0.3))),
          confidence: s.confidence,
          predictedFalsePositiveDelta: s.source === 'cost' ? 0.01 : 0.005,
          predictedBypassDelta: s.source === 'threat' || s.source === 'attack' ? 0 : 0.002,
          blastRadiusPercent: s.source === 'threat' ? 0.04 : 0.08,
          rollbackConfidence: Math.max(0.75, Math.min(0.99, 0.7 + (s.confidence * 0.3))),
          canarySizePercent: 0.05,
        },
      });
      s.autopilot = {
        safetyAllowed: safety.allowed,
        safetyBlockers: safety.blockers,
        impactOverall: impact.overall,
        recommendation: impact.recommendation,
      };
    }

    // Sort by confidence descending
    allSuggestions.sort((a, b) => b.confidence - a.confidence);

    // ── 7. Auto-apply (opt-in only) ───────────────────────
    const autoApply: UnifiedSuggestion[] = [];
    if (isAiAutoApplyEnabled() && !this.selfImprovement.isThresholdAdjustmentFrozen()) {
      const threshold = this.selfImprovement.getAdaptiveThreshold() || this.config.autoApplyThreshold;
      const toApply = allSuggestions.filter((s) => {
        const minConfidence = s.source === 'attack' ? Math.max(threshold, attackMinConfidence()) : threshold;
        if (s.confidence < minConfidence) return false;
        if (!s.autopilot?.safetyAllowed) return false;
        if (s.autopilot?.recommendation === 'hold') return false;
        const patterns = s.rule.argPatterns?.join(' ') || '';
        if (wouldDisableDangerousBlocking(s.rule.name, patterns, true)) {
          Logger.warn(`[SuggestionEngine] Skipping auto-apply of dangerous unblock: ${s.rule.name}`);
          return false;
        }
        return true;
      });
      if (toApply.length > 0) {
        createLearningSnapshot();
        this.autoApplyRules(toApply);
        autoApply.push(...toApply);
      }
      for (const s of autoApply) {
        this.selfImprovement.recordOutcome({
          suggestionId: s.id,
          ruleName: s.rule.name,
          source: s.source,
          action: 'applied',
          confidence: s.confidence,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // ── 8. Prune ineffective rules ──────────────────────
    const pruneList = this.selfImprovement.suggestPruning();

    // ── 9. Generate comprehensive report ─────────────────
    const baselines = this.baselineLearner.getAllBaselines();
    this.baselineLearner.saveToFile();
    this.selfImprovement.recordCycleComplete({
      recordsAnalyzed: snapshot.callRecords.length,
      baselinesLearned: baselines.length,
      suggestionsGenerated: allSuggestions.length,
    });
    const autoRuleNames = autoApply.map(s => s.rule.name);
    const report = this.reporter.generateFullReport(
      snapshot, baselines, insights, temporal,
      autoRuleNames, this.selfImprovement.getState(), pruneList,
    );

    Logger.info(`[SuggestionEngine] Cycle complete: ${allSuggestions.length} suggestions, ${autoApply.length} auto-applied, ${insights.length} insights`);

    this.savePendingSuggestions(allSuggestions);
    this.saveComprehensiveReport(report);
    broadcastDashboardEvent({
      type: 'ai:suggestions',
      payload: { suggestions: allSuggestions, autoApplied: autoApply.length },
      timestamp: Date.now(),
    });
    broadcastDashboardEvent({
      type: 'ai:report',
      payload: { updatedAt: report.timestamp },
      timestamp: Date.now(),
    });

    return { suggestions: allSuggestions, autoApplied: autoApply, insights, report };
  }

  private saveComprehensiveReport(report: ComprehensiveReport): void {
    try {
      const plainText = this.reporter.toPlainText(report);
      const path = resolveAiReportPath();
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, JSON.stringify({
        updatedAt: report.timestamp,
        plainText,
        report,
      }, null, 2));
      writeFileSync(path.replace(/\.json$/, '.txt'), plainText);
    } catch (err: unknown) {
      Logger.debug(
        `[SuggestionEngine] Failed to save report: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Persist latest suggestions for TUI/dashboard (not yet accepted/rejected). */
  private savePendingSuggestions(suggestions: UnifiedSuggestion[]): void {
    try {
      const path = resolveAiPendingSuggestionsPath();
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, JSON.stringify({
        updatedAt: new Date().toISOString(),
        suggestions: suggestions.map((s) => ({
          id: s.id,
          ruleName: s.rule.name,
          rule: s.rule,
          confidence: s.confidence,
          reason: s.reason,
          source: s.source,
          estimatedSavings: s.estimatedSavings,
          autopilot: s.autopilot,
        })),
      }, null, 2));
      void import('../utils/metrics.js').then(({ setSuggestionQueueDepth }) => {
        setSuggestionQueueDepth(suggestions.length);
      });
    } catch (err: unknown) {
      Logger.debug(`[SuggestionEngine] Failed to save pending suggestions: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Record user accept/reject from TUI or dashboard API. */
  recordUserOutcome(
    suggestionId: string,
    action: 'applied' | 'rejected',
    meta: {
      ruleName: string;
      source: LearningOutcome['source'];
      confidence: number;
      userId?: string;
      pattern?: string;
    },
  ): void {
    this.selfImprovement.recordOutcome({
      suggestionId,
      ruleName: meta.ruleName,
      source: meta.source,
      action,
      confidence: meta.confidence,
      timestamp: new Date().toISOString(),
    }, { userId: meta.userId, pattern: meta.pattern });
    broadcastDashboardEvent({
      type: 'ai:state',
      payload: { state: this.selfImprovement.getState() },
      timestamp: Date.now(),
    });
  }

  /** Generate a comprehensive report (alias for convenience) */
  async generateReport(): Promise<ComprehensiveReport> {
    const { report } = await this.runLearningCycle();
    return report;
  }

  /** Start periodic analysis */
  startPeriodicAnalysis(): void {
    if (this.analysisTimer) return;
    Logger.info(`[SuggestionEngine] Starting periodic analysis every ${this.config.analysisIntervalMs / 1000}s`);
    this.analysisTimer = setInterval(() => {
      this.runLearningCycle().catch(err => {
        Logger.error(`[SuggestionEngine] Periodic analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.config.analysisIntervalMs);
  }

  /** Stop periodic analysis */
  stopPeriodicAnalysis(): void {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
  }

  /** Get the underlying self-improvement engine for direct access */
  getSelfImprovement(): SelfImprovement {
    return this.selfImprovement;
  }

  /** Get the baseline learner for direct access */
  getBaselineLearner(): BaselineLearner {
    return this.baselineLearner;
  }

  /** Get the data collector for direct access */
  getDataCollector(): DataCollector {
    return this.collector;
  }

  /** Get the policy assist for NL → YAML generation */
  getPolicyAssist(): PolicyAssist {
    return this.policyAssist;
  }

  /** Get the threat intel for feed processing */
  getThreatIntel(): ThreatIntel {
    return this.threatIntel;
  }

  /** Process a threat feed through the full pipeline */
  processThreatFeed(feedPath: string): UnifiedSuggestion[] {
    const threatSuggestions = this.threatIntel.processFeed(feedPath);
    return threatSuggestions.map(s => ({
      id: `threat-${suggestionCounter++}`,
      rule: s.rule,
      confidence: this.selfImprovement.adjustConfidence(s.confidence, 'threat'),
      reason: s.reason,
      source: 'threat',
    }));
  }

  /** Process an NL goal through the pipeline */
  processPolicyGoal(goal: string, availableTools?: string[]): UnifiedSuggestion | null {
    const assistSuggestion = this.policyAssist.generateRule(goal, availableTools);
    if (!assistSuggestion) return null;
    return {
      id: `assist-${suggestionCounter++}`,
      rule: assistSuggestion.rule,
      confidence: this.selfImprovement.adjustConfidence(assistSuggestion.confidence, 'assist'),
      reason: assistSuggestion.reason,
      source: 'assist',
    };
  }

  /** Auto-apply suggestions by writing to policy YAML */
  private autoApplyRules(suggestions: UnifiedSuggestion[]): void {
    try {
      const rulesYAML = suggestions
        .map(s => {
          const lines: string[] = [];
          lines.push(`  - name: ${s.rule.name}`);
          if (s.rule.description) lines.push(`    description: "${s.rule.description}"`);
          lines.push(`    action: ${s.rule.action}`);
          if (s.rule.maxTokens) lines.push(`    maxTokens: ${s.rule.maxTokens}`);
          if (s.rule.maxCallsPerMinute) lines.push(`    maxCallsPerMinute: ${s.rule.maxCallsPerMinute}`);
          if (s.rule.tools?.deny?.length || s.rule.tools?.allow?.length) {
            const toolLines: string[] = ['    tools:'];
            if (s.rule.tools?.deny?.length) toolLines.push(`      deny: [${s.rule.tools.deny.join(', ')}]`);
            if (s.rule.tools?.allow?.length) toolLines.push(`      allow: [${s.rule.tools.allow.join(', ')}]`);
            lines.push(toolLines.join('\n'));
          }
          return lines.join('\n');
        })
        .join('\n');

      const yaml = `# Auto-generated by MCP Mastyf AI AI Suggestion Engine\n# Generated: ${new Date().toISOString()}\n# Auto-apply threshold: ${this.selfImprovement.getAdaptiveThreshold()}\n\nrules:\n${rulesYAML}\n`;
      writeFileSync(this.config.policyOutputPath, yaml);
      Logger.info(`[SuggestionEngine] Auto-applied ${suggestions.length} rules → ${this.config.policyOutputPath}`);
    } catch (err: unknown) {
      Logger.error(`[SuggestionEngine] Failed to auto-apply rules: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private toUnified(s: AnomalySuggestion): UnifiedSuggestion {
    return {
      id: `baseline-${suggestionCounter++}`,
      rule: s.rule,
      confidence: this.selfImprovement.adjustConfidence(s.confidence, 'baseline'),
      reason: s.reason,
      source: 'baseline',
    };
  }
}

/** Global engine instance initialized during proxy startup */
let globalEngine: SuggestionEngine | null = null;

/** Get the running AI engine instance */
export function getAiEngine(): SuggestionEngine | null {
  return globalEngine;
}

/** Lazy-init AI engine for dashboard-only or late-bound DB (idempotent). */
export async function ensureAiEngineInitialized(
  historyDb: unknown,
  servers?: McpServerConfig[],
): Promise<SuggestionEngine | null> {
  if (!isAiLearningEnabled()) return null;
  if (globalEngine) return globalEngine;

  const db = historyDb as HistoryDatabase;
  let resolved = servers;
  if (!resolved?.length) {
    const names = await getAllActiveServerNames(db);
    resolved = names.length
      ? serversFromNames(names)
      : [{ name: 'mastyf-dashboard', transport: 'stdio' }];
  }
  return initializeAiEngine(db, resolved);
}

/** Remove a suggestion from the pending queue after accept/reject. */
export function removePendingSuggestion(
  suggestionId: string,
  opts?: { ruleName?: string; tenantId?: string },
): boolean {
  try {
    const path = resolveAiPendingSuggestionsPath(opts?.tenantId);
    if (!existsSync(path)) return false;
    const body = JSON.parse(readFileSync(path, 'utf-8')) as {
      updatedAt?: string;
      suggestions?: Array<{ id: string; ruleName?: string }>;
    };
    const before = body.suggestions?.length ?? 0;
    const id = suggestionId.trim();
    const ruleName = opts?.ruleName?.trim();
    body.suggestions = (body.suggestions ?? []).filter(
      (s) => s.id !== id && (!ruleName || s.ruleName !== ruleName),
    );
    if (body.suggestions.length === before) return false;
    body.updatedAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(body, null, 2));
    void import('../utils/metrics.js').then(({ setSuggestionQueueDepth }) => {
      setSuggestionQueueDepth(body.suggestions!.length);
    });
    broadcastDashboardEvent({
      type: 'ai:suggestions',
      payload: { suggestions: body.suggestions, removed: id },
      timestamp: Date.now(),
    });
    return true;
  } catch (err: unknown) {
    Logger.debug(
      `[SuggestionEngine] Failed to remove pending suggestion: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/** Read persisted pending suggestions (fast — no learning cycle). */
export function loadPendingSuggestions(tenantId?: string): Array<{
  id: string;
  ruleName?: string;
  confidence?: number;
  reason?: string;
  source?: string;
  rule?: PolicyRule;
  estimatedSavings?: number;
  autopilot?: Record<string, unknown>;
}> {
  try {
    const path = resolveAiPendingSuggestionsPath(tenantId);
    if (!existsSync(path)) return [];
    const body = JSON.parse(readFileSync(path, 'utf-8')) as {
      suggestions?: Array<{
        id: string;
        ruleName?: string;
        confidence?: number;
        reason?: string;
        source?: string;
        rule?: PolicyRule;
        estimatedSavings?: number;
        autopilot?: Record<string, unknown>;
      }>;
    };
    return body.suggestions ?? [];
  } catch {
    return [];
  }
}

/** Initialize and start the AI engine with live data */
export async function initializeAiEngine(
  historyDb: any,
  servers: any[],
): Promise<SuggestionEngine> {
  const { HistoryDatabase } = await import('../database/history-db.js');
  const { DataCollector } = await import('./data-collector.js');
  const { BaselineLearner } = await import('./baseline-learner.js');
  const { CostOptimizer } = await import('./cost-optimizer.js');
  const { getSharedThreatIntel, startThreatIntelPollingIfEnabled } = await import('./threat-intel.js');
  const { PolicyAssist } = await import('./policy-assist.js');
  const { PatternRecognizer } = await import('./pattern-recognizer.js');
  const { SelfImprovement } = await import('./self-improvement.js');
  const { CostAuditor } = await import('../services/cost-auditor.js');
  const { PricingClient } = await import('../clients/pricing-client.js');

  const pricingClient = new PricingClient();
  const costAuditor = new CostAuditor(pricingClient, historyDb);
  const useDbSnapshots =
    process.env.MASTYF_AI_AI_USE_DB_SNAPSHOTS !== 'false'
    || process.env.MASTYF_AI_AI_SKIP_EXTERNAL_FETCH === 'true';
  let collector: InstanceType<typeof DataCollector>;
  if (useDbSnapshots) {
    collector = new DataCollector(historyDb, undefined, costAuditor, undefined, pricingClient);
  } else {
    const { SecurityScanner } = await import('../services/security-scanner.js');
    const { HealthMonitor } = await import('../services/health-monitor.js');
    collector = new DataCollector(
      historyDb,
      new SecurityScanner(),
      costAuditor,
      new HealthMonitor(historyDb),
      pricingClient,
    );
  }
  const baselineLearner = new BaselineLearner();
  baselineLearner.loadFromFile();
  const costOptimizer = new CostOptimizer(historyDb, costAuditor);
  const threatIntel = getSharedThreatIntel();
  const policyAssist = new PolicyAssist();
  const patternRecognizer = new PatternRecognizer();
  const { resolveAiLearningStatePath } = await import('./self-improvement.js');
  const selfImprovement = new SelfImprovement(resolveAiLearningStatePath());

  const engineConfig: Partial<SuggestionEngineConfig> = {
    analysisIntervalMs: parseInt(process.env.MASTYF_AI_AI_ANALYSIS_INTERVAL_MS || String(15 * 60 * 1000), 10),
    autoApplyThreshold: parseFloat(process.env.MASTYF_AI_AI_AUTO_APPLY_THRESHOLD || '0.85'),
    policyOutputPath: process.env.MASTYF_AI_AI_POLICY_OUTPUT || './default-policy-auto-generated.yaml',
  };

  const engine = new SuggestionEngine(
    collector, baselineLearner, costOptimizer,
    threatIntel, policyAssist, patternRecognizer, selfImprovement,
    engineConfig,
  );
  registerDataCollector(collector);
  engine.setServers(servers);

  if (process.env.MASTYF_AI_AI_DISABLE_PERIODIC !== 'true') {
    engine.startPeriodicAnalysis();
  }

  startThreatIntelPollingIfEnabled();

  globalEngine = engine;
  Logger.info('[SuggestionEngine] AI Engine initialized with live data sources');

  if (process.env.MASTYF_AI_AI_SKIP_INITIAL_CYCLE !== 'true') {
    engine.runLearningCycle().catch(err => {
      Logger.warn(`[SuggestionEngine] Initial learning cycle failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  return engine;
}

/** Build minimal server configs from DB server names. */
export function serversFromNames(names: string[]): McpServerConfig[] {
  return names.map((name) => ({ name, transport: 'stdio' as const }));
}

/** Run learning cycle against the history database (proxy, TUI, scan hooks). */
export async function runLearningCycleForDb(
  historyDb?: HistoryDatabase,
  servers?: McpServerConfig[],
): Promise<ReturnType<SuggestionEngine['runLearningCycle']> | null> {
  if (!isAiLearningEnabled()) return null;

  const db = historyDb || new HistoryDatabase();
  const names = servers?.map((s) => s.name) ?? await getAllActiveServerNames(db);
  if (names.length === 0) {
    Logger.warn('[SuggestionEngine] No servers in DB — skipping learning cycle');
    return null;
  }
  const resolvedServers = servers?.length ? servers : serversFromNames(names);

  let engine = globalEngine;
  if (!engine) {
    engine = await initializeAiEngine(db, resolvedServers);
  } else {
    engine.setServers(resolvedServers);
  }
  return engine.runLearningCycle();
}

/** Run one learning cycle when AI learning is enabled (scan/audit/report hooks). */
export async function triggerLearningCycleIfEnabled(
  historyDb?: unknown,
  servers: McpServerConfig[] = [],
  opts?: { cliCommand?: boolean },
): Promise<void> {
  if (!isAiLearningEnabled()) return;
  if (opts?.cliCommand && !isAiLearningOnCliCommands()) return;
  await runLearningCycleForDb(historyDb as HistoryDatabase, servers);
}

export { recordPolicyDecisionGlobal };

/** Roll back AI learning state to the latest snapshot (CLI / dashboard API). */
export function rollbackAiLearning(): { ok: boolean; snapshotId?: string; reason?: string } {
  if (globalEngine) {
    return globalEngine.getSelfImprovement().rollback();
  }
  return new SelfImprovement().rollback();
}

export async function recordSuggestionOutcome(
  suggestionId: string,
  action: 'applied' | 'rejected',
  meta: {
    ruleName: string;
    source: LearningOutcome['source'] | 'attack';
    confidence: number;
    rule?: import('../policy/policy-types.js').PolicyRule;
    policyPath?: string | null;
    policyWatcher?: PolicyWatcher | null;
    userId?: string;
    pattern?: string;
    tenantId?: string;
  },
): Promise<void> {
  const patterns = meta.pattern || meta.rule?.argPatterns?.join(' ');
  if (action === 'applied' && meta.rule) {
    const { applySuggestionToPolicy } = await import('./policy-applier.js');
    await applySuggestionToPolicy(meta.rule, meta.policyPath, meta.policyWatcher ?? null);
  }

  removePendingSuggestion(suggestionId, { ruleName: meta.ruleName, tenantId: meta.tenantId });

  if (globalEngine) {
    globalEngine.recordUserOutcome(suggestionId, action, {
      ruleName: meta.ruleName,
      source: meta.source as LearningOutcome['source'],
      confidence: meta.confidence,
      userId: meta.userId,
      pattern: patterns,
    });
    return;
  }
  const { SelfImprovement } = await import('./self-improvement.js');
  new SelfImprovement().recordOutcome({
    suggestionId,
    ruleName: meta.ruleName,
    source: meta.source,
    action,
    confidence: meta.confidence,
    timestamp: new Date().toISOString(),
  }, { userId: meta.userId, pattern: patterns });
}
