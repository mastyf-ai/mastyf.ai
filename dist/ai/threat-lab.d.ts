import { LlmAssistant } from './llm-assistant.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import type { PolicyRule } from '../policy/policy-types.js';
import type { StoredSemanticAudit } from './semantic-audit-store.js';
import type { ThreatIntelEntry } from './threat-intel.js';
export interface CorpusCandidate {
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    expected: 'block' | 'pass';
    category: string;
    ruleHint?: string;
}
export interface ThreatLabDiscovery {
    attackClass: string;
    hypothesis: string;
    corpusCandidate: CorpusCandidate;
    policyRule: PolicyRule;
    confidence: number;
}
export type ThreatLabSource = 'bypass' | 'semantic-tp' | 'threat-intel' | 'corpus-proactive' | 'vuln-discovery';
export interface ThreatLabCandidateProvenance {
    source: ThreatLabSource;
    llmUsed: boolean;
    inputFingerprint?: string;
    corpusSeedId?: string;
}
export interface ThreatLabValidationResult {
    ok: boolean;
    errors: string[];
    replayBlocked?: boolean;
}
export interface BypassContext {
    fingerprint?: string;
    toolName?: string;
    tool?: string;
    category?: string;
    ruleHint?: string;
    payload?: string;
    arguments?: Record<string, unknown>;
    args?: Record<string, unknown>;
    block_reason?: string;
    reason?: string;
}
/** Policy used for corpus fixture replay validation (independent of live proxy policy). */
export declare function corpusReplayPolicyPath(): string;
export declare function loadCorpusReplayPolicyEngine(): PolicyEngine | null;
/** Load authentic corpus attack fixtures for LLM schema context. */
export declare function loadCorpusSamples(opts?: {
    category?: string;
    limit?: number;
}): Array<CorpusCandidate & {
    relPath: string;
}>;
/** Records synthesized by calibrate-semantic seed — not authentic async semantic audits. */
export declare function isCalibratorSeededRecord(record: StoredSemanticAudit): boolean;
/** Human or proxy-originated semantic true-positive suitable for Threat Lab. */
export declare function isAuthenticSemanticTp(record: StoredSemanticAudit): boolean;
export declare function threatLabRequireLlm(): boolean;
export declare function threatLabLlmConfig(): Partial<import('./llm-assistant.js').LlmAssistantConfig>;
export declare function ensureThreatLabLlmReady(llm?: LlmAssistant): Promise<{
    ok: boolean;
    llm: LlmAssistant;
    reason?: string;
}>;
export declare function validateCorpusCandidateSchema(candidate: unknown): string[];
export declare function validatePolicyRuleSafe(rule: PolicyRule): string[];
/** Smoke-test: attack fixtures should be blocked by corpus replay policy (default-policy.yaml by default). */
export declare function evaluateCorpusFixture(candidate: CorpusCandidate, engine?: PolicyEngine | null): {
    blocked: boolean;
    rule?: string;
};
export declare function validateThreatLabDiscovery(discovery: ThreatLabDiscovery, opts?: {
    requireReplayBlock?: boolean;
}): ThreatLabValidationResult;
export declare function parseDiscoveryJson(text: string): ThreatLabDiscovery | null;
interface DiscoverContext {
    bypass?: BypassContext;
    corpusSeed?: CorpusCandidate & {
        relPath?: string;
    };
    threatEntry?: ThreatIntelEntry;
    semanticRecord?: StoredSemanticAudit;
    seq?: number;
}
/** Batched variant — one LLM call returns N candidates (array JSON), validated individually. */
export declare function discoverBatchViaLlm(llm: LlmAssistant, ctx: DiscoverContext, count: number): Promise<ThreatLabDiscovery[]>;
export declare function discoverFromBypass(bypass: BypassContext, opts?: {
    llm?: LlmAssistant;
    seq?: number;
}): Promise<ThreatLabDiscovery | null>;
export declare function semanticFlagMinConfidence(): number;
/** High-confidence async semantic flag — no human TP label required (auto threat research). */
export declare function discoverFromSemanticFlag(record: StoredSemanticAudit, opts?: {
    llm?: LlmAssistant;
    seq?: number;
}): Promise<ThreatLabDiscovery | null>;
export declare function discoverFromSemanticAudit(record: StoredSemanticAudit, opts?: {
    llm?: LlmAssistant;
    seq?: number;
}): Promise<ThreatLabDiscovery | null>;
export declare function discoverFromThreatIntel(entry: ThreatIntelEntry, opts?: {
    llm?: LlmAssistant;
    seq?: number;
}): Promise<ThreatLabDiscovery | null>;
/** Proactive red-team: mutate an authentic corpus attack fixture via LLM (no synthetic payloads). */
export declare function discoverFromCorpusSeed(seed: CorpusCandidate & {
    relPath?: string;
}, opts?: {
    llm?: LlmAssistant;
    seq?: number;
}): Promise<ThreatLabDiscovery | null>;
export declare function threatLabMaxCandidates(): number;
export declare function threatLabEnabled(): boolean;
export declare function threatLabMode(): 'reactive' | 'proactive';
export declare function threatLabSemanticEnabled(): boolean;
/**
 * Discover attack probes / policy mitigations from a VulnFinding (unpublished vuln discovery).
 */
export declare function discoverFromVulnFinding(finding: {
    id: string;
    class: string;
    severity: string;
    title: string;
    description: string;
    target: {
        kind: string;
        name: string;
        version?: string;
    };
    evidence: {
        reproSteps: string[];
        scanner: string;
    };
    analysisExecutiveSummary?: string;
    exploitScenario?: string;
}, opts?: {
    llm?: LlmAssistant;
    seq?: number;
}): Promise<ThreatLabDiscovery | null>;
export {};
//# sourceMappingURL=threat-lab.d.ts.map