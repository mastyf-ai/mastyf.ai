import { DataCollector, recordPolicyDecisionGlobal } from './data-collector.js';
import { BaselineLearner } from './baseline-learner.js';
import { CostOptimizer } from './cost-optimizer.js';
import { ThreatIntel } from './threat-intel.js';
import { PolicyAssist } from './policy-assist.js';
import { PatternRecognizer, CrossLayerInsight } from './pattern-recognizer.js';
import { SelfImprovement, LearningOutcome } from './self-improvement.js';
import { ComprehensiveReport } from './comprehensive-reporter.js';
import { PolicyRule } from '../policy/policy-types.js';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import type { McpServerConfig } from '../types.js';
import { HistoryDatabase } from '../database/history-db.js';
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
export declare class SuggestionEngine {
    private collector;
    private baselineLearner;
    private costOptimizer;
    private threatIntel;
    private policyAssist;
    private patternRecognizer;
    private selfImprovement;
    private reporter;
    private config;
    private servers;
    private analysisTimer;
    constructor(collector: DataCollector, baselineLearner: BaselineLearner, costOptimizer: CostOptimizer, threatIntel: ThreatIntel, policyAssist: PolicyAssist, patternRecognizer: PatternRecognizer, selfImprovement: SelfImprovement, config?: Partial<SuggestionEngineConfig>);
    /** Set the server list for analysis context */
    setServers(servers: McpServerConfig[]): void;
    /**
     * Run a full analysis cycle: collect → analyze → suggest → score → filter → auto-apply → learn.
     */
    runLearningCycle(): Promise<{
        suggestions: UnifiedSuggestion[];
        autoApplied: UnifiedSuggestion[];
        insights: CrossLayerInsight[];
        report: ComprehensiveReport;
    }>;
    private saveComprehensiveReport;
    /** Persist latest suggestions for TUI/dashboard (not yet accepted/rejected). */
    private savePendingSuggestions;
    /** Record user accept/reject from TUI or dashboard API. */
    recordUserOutcome(suggestionId: string, action: 'applied' | 'rejected', meta: {
        ruleName: string;
        source: LearningOutcome['source'];
        confidence: number;
        userId?: string;
        pattern?: string;
    }): void;
    /** Generate a comprehensive report (alias for convenience) */
    generateReport(): Promise<ComprehensiveReport>;
    /** Start periodic analysis */
    startPeriodicAnalysis(): void;
    /** Stop periodic analysis */
    stopPeriodicAnalysis(): void;
    /** Get the underlying self-improvement engine for direct access */
    getSelfImprovement(): SelfImprovement;
    /** Get the baseline learner for direct access */
    getBaselineLearner(): BaselineLearner;
    /** Get the data collector for direct access */
    getDataCollector(): DataCollector;
    /** Get the policy assist for NL → YAML generation */
    getPolicyAssist(): PolicyAssist;
    /** Get the threat intel for feed processing */
    getThreatIntel(): ThreatIntel;
    /** Process a threat feed through the full pipeline */
    processThreatFeed(feedPath: string): UnifiedSuggestion[];
    /** Process an NL goal through the pipeline */
    processPolicyGoal(goal: string, availableTools?: string[]): UnifiedSuggestion | null;
    /** Auto-apply suggestions by writing to policy YAML */
    private autoApplyRules;
    private toUnified;
}
/** Get the running AI engine instance */
export declare function getAiEngine(): SuggestionEngine | null;
/** Lazy-init AI engine for dashboard-only or late-bound DB (idempotent). */
export declare function ensureAiEngineInitialized(historyDb: unknown, servers?: McpServerConfig[]): Promise<SuggestionEngine | null>;
/** Remove a suggestion from the pending queue after accept/reject. */
export declare function removePendingSuggestion(suggestionId: string, opts?: {
    ruleName?: string;
    tenantId?: string;
}): boolean;
/** Read persisted pending suggestions (fast — no learning cycle). */
export declare function loadPendingSuggestions(tenantId?: string): Array<{
    id: string;
    ruleName?: string;
    confidence?: number;
    reason?: string;
    source?: string;
    rule?: PolicyRule;
    estimatedSavings?: number;
    autopilot?: Record<string, unknown>;
}>;
/** Initialize and start the AI engine with live data */
export declare function initializeAiEngine(historyDb: any, servers: any[]): Promise<SuggestionEngine>;
/** Build minimal server configs from DB server names. */
export declare function serversFromNames(names: string[]): McpServerConfig[];
/** Run learning cycle against the history database (proxy, TUI, scan hooks). */
export declare function runLearningCycleForDb(historyDb?: HistoryDatabase, servers?: McpServerConfig[]): Promise<ReturnType<SuggestionEngine['runLearningCycle']> | null>;
/** Run one learning cycle when AI learning is enabled (scan/audit/report hooks). */
export declare function triggerLearningCycleIfEnabled(historyDb?: unknown, servers?: McpServerConfig[], opts?: {
    cliCommand?: boolean;
}): Promise<void>;
export { recordPolicyDecisionGlobal };
/** Roll back AI learning state to the latest snapshot (CLI / dashboard API). */
export declare function rollbackAiLearning(): {
    ok: boolean;
    snapshotId?: string;
    reason?: string;
};
export declare function recordSuggestionOutcome(suggestionId: string, action: 'applied' | 'rejected', meta: {
    ruleName: string;
    source: LearningOutcome['source'] | 'attack';
    confidence: number;
    rule?: import('../policy/policy-types.js').PolicyRule;
    policyPath?: string | null;
    policyWatcher?: PolicyWatcher | null;
    userId?: string;
    pattern?: string;
    tenantId?: string;
}): Promise<void>;
//# sourceMappingURL=suggestion-engine.d.ts.map