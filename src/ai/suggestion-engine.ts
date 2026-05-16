import { DataCollector, GovernanceSnapshot } from './data-collector.js';
import { BaselineLearner, AnomalySuggestion } from './baseline-learner.js';
import { CostOptimizer, CostSuggestion } from './cost-optimizer.js';
import { ThreatIntel, ThreatSuggestion } from './threat-intel.js';
import { PolicyAssist, AssistSuggestion } from './policy-assist.js';
import { PatternRecognizer, CrossLayerInsight } from './pattern-recognizer.js';
import { SelfImprovement, LearningOutcome } from './self-improvement.js';
import { ComprehensiveReporter, ComprehensiveReport } from './comprehensive-reporter.js';
import { PolicyRule } from '../policy/policy-types.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import { McpServerConfig } from '../types.js';
import { PricingClient } from '../clients/pricing-client.js';
import { Logger } from '../utils/logger.js';
import { writeFileSync } from 'fs';

export interface UnifiedSuggestion {
  id: string;
  rule: PolicyRule;
  confidence: number;
  reason: string;
  source: 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern';
  estimatedSavings?: number;
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
      for (const s of anomalySuggestions) {
        allSuggestions.push(this.toUnified(s));
      }
    }

    if (this.config.enabledModules.includes('cost')) {
      // Use live PricingClient for per-model token prices
      const pricingClient = new PricingClient();
      // Sample the first few records to determine dominant model
      const modelCounts = new Map<string, number>();
      for (const r of snapshot.callRecords.slice(0, 50)) {
        const model = (r as any).model || 'gpt-4o';
        modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
      }
      let dominantModel = 'gpt-4o';
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

    // Note: threat-intel requires a feed file; call processFeed() externally
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

    // ── 5. Adjust confidence via self-improvement ────────
    for (const s of allSuggestions) {
      s.confidence = this.selfImprovement.adjustConfidence(s.confidence, s.source);
    }

    // Sort by confidence descending
    allSuggestions.sort((a, b) => b.confidence - a.confidence);

    // ── 6. Auto-apply high-confidence suggestions ────────
    // Use config.autoApplyThreshold as fallback when adaptive threshold is not yet tuned
    const threshold = this.selfImprovement.getAdaptiveThreshold() || this.config.autoApplyThreshold;
    const autoApply = allSuggestions.filter(s => s.confidence >= threshold);
    if (autoApply.length > 0) {
      this.autoApplyRules(autoApply);
    }

    // Record outcomes for auto-applied rules
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

    // ── 7. Prune ineffective rules ──────────────────────
    const pruneList = this.selfImprovement.suggestPruning();

    // ── 8. Generate comprehensive report ─────────────────
    const baselines = this.baselineLearner.getAllBaselines();
    const autoRuleNames = autoApply.map(s => s.rule.name);
    const report = this.reporter.generateFullReport(
      snapshot, baselines, insights, temporal,
      autoRuleNames, this.selfImprovement.getState(), pruneList,
    );

    Logger.info(`[SuggestionEngine] Cycle complete: ${allSuggestions.length} suggestions, ${autoApply.length} auto-applied, ${insights.length} insights`);

    return { suggestions: allSuggestions, autoApplied: autoApply, insights, report };
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
        Logger.error(`[SuggestionEngine] Periodic analysis failed: ${err?.message}`);
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

      const yaml = `# Auto-generated by MCP Guardian AI Suggestion Engine\n# Generated: ${new Date().toISOString()}\n# Auto-apply threshold: ${this.selfImprovement.getAdaptiveThreshold()}\n\nrules:\n${rulesYAML}\n`;
      writeFileSync(this.config.policyOutputPath, yaml);
      Logger.info(`[SuggestionEngine] Auto-applied ${suggestions.length} rules → ${this.config.policyOutputPath}`);
    } catch (err: any) {
      Logger.error(`[SuggestionEngine] Failed to auto-apply rules: ${err?.message}`);
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

/** Initialize and start the AI engine with live data */
export async function initializeAiEngine(
  historyDb: any,
  servers: any[],
): Promise<SuggestionEngine> {
  const { HistoryDatabase } = await import('../database/history-db.js');
  const { DataCollector } = await import('./data-collector.js');
  const { BaselineLearner } = await import('./baseline-learner.js');
  const { CostOptimizer } = await import('./cost-optimizer.js');
  const { ThreatIntel } = await import('./threat-intel.js');
  const { PolicyAssist } = await import('./policy-assist.js');
  const { PatternRecognizer } = await import('./pattern-recognizer.js');
  const { SelfImprovement } = await import('./self-improvement.js');
  const { CostAuditor } = await import('../services/cost-auditor.js');
  const { PricingClient } = await import('../clients/pricing-client.js');

  const pricingClient = new PricingClient();
  const costAuditor = new CostAuditor(pricingClient, historyDb);
  const collector = new DataCollector(historyDb);
  const baselineLearner = new BaselineLearner();
  const costOptimizer = new CostOptimizer(historyDb, costAuditor);
  const threatIntel = new ThreatIntel();
  const policyAssist = new PolicyAssist();
  const patternRecognizer = new PatternRecognizer();
  const selfImprovement = new SelfImprovement();

  const engine = new SuggestionEngine(
    collector, baselineLearner, costOptimizer,
    threatIntel, policyAssist, patternRecognizer, selfImprovement,
  );
  engine.setServers(servers);

  // Start periodic analysis (default: every 15 minutes, controlled by DEFAULT_CONFIG.analysisIntervalMs)
  engine.startPeriodicAnalysis();

  // Start live threat feed polling
  threatIntel.startLivePolling();

  globalEngine = engine;
  Logger.info('[SuggestionEngine] AI Engine initialized with live data sources');

  // Run initial learning cycle immediately
  engine.runLearningCycle().catch(err => {
    Logger.warn(`[SuggestionEngine] Initial learning cycle failed: ${err?.message}`);
  });

  return engine;
}
