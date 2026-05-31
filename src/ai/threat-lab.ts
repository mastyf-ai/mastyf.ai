/**
 * Threat Lab — LLM-driven threat discovery for Security Swarm and runtime learning.
 * Proposes corpus fixtures and policy rules from authentic bypasses, semantic audits, and ThreatIntel.
 * Requires a healthy local LLM (Ollama); no synthetic fallback candidates.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { LlmAssistant } from './llm-assistant.js';
import { isDangerousUnblockPattern } from './learning-quorum.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { resetSessionFlowHistory } from '../policy/session-flow-store.js';
import type { PolicyConfig, PolicyRule, CallContext } from '../policy/policy-types.js';
import type { StoredSemanticAudit } from './semantic-audit-store.js';
import type { ThreatIntelEntry } from './threat-intel.js';
import { Logger } from '../utils/logger.js';

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

export type ThreatLabSource = 'bypass' | 'semantic-tp' | 'threat-intel' | 'corpus-proactive';

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

const DEFAULT_POLICY_PATH = join(process.cwd(), 'default-policy.yaml');
const CORPUS_ATTACKS_ROOT = join(process.cwd(), 'corpus', 'attacks');
const CALIBRATOR_SEED_PREFIX = 'Swarm seed from live MCP (';

const DISCOVERY_SYSTEM_PROMPT = `You are an MCP security red-team researcher.
Given authentic bypass, audit, CVE, or corpus context, propose ONE novel attack probe and a matching policy rule.
Output ONLY valid JSON (no markdown):
{
  "attackClass": "short-kebab-case-id",
  "hypothesis": "one sentence",
  "corpusCandidate": {
    "id": "threat-lab-NNN",
    "toolName": "search",
    "arguments": { "query": "..." },
    "expected": "block",
    "category": "prompt-injection",
    "ruleHint": "semantic-prompt-injection"
  },
  "policyRule": {
    "name": "threat-lab-rule-name",
    "description": "...",
    "action": "block",
    "patterns": ["regex-safe-pattern"]
  },
  "confidence": 0.0-1.0
}
Use realistic MCP tool names from the context. Patterns must be valid JavaScript regex (no delimiters).
Base corpusCandidate.arguments on the supplied context — do not invent placeholder comments.`;

function defaultPolicyPath(): string {
  return process.env.GUARDIAN_POLICY_PATH || DEFAULT_POLICY_PATH;
}

/** Policy used for corpus fixture replay validation (independent of live proxy policy). */
export function corpusReplayPolicyPath(): string {
  return process.env.GUARDIAN_CORPUS_REPLAY_POLICY_PATH || DEFAULT_POLICY_PATH;
}

function loadPolicyEngineFromPath(path: string): PolicyEngine | null {
  if (!existsSync(path)) return null;
  try {
    const policy = load(readFileSync(path, 'utf-8')) as PolicyConfig;
    return new PolicyEngine(policy);
  } catch {
    return null;
  }
}

function loadPolicyEngine(): PolicyEngine | null {
  return loadPolicyEngineFromPath(defaultPolicyPath());
}

export function loadCorpusReplayPolicyEngine(): PolicyEngine | null {
  return loadPolicyEngineFromPath(corpusReplayPolicyPath());
}

function evalCtx(toolName: string, args: Record<string, unknown>): CallContext {
  return {
    serverName: 'threat-lab',
    toolName,
    arguments: args,
    requestId: 'threat-lab-1',
    requestTokens: 50,
    timestamp: new Date().toISOString(),
  };
}

let corpusSamplesCache: Array<CorpusCandidate & { relPath: string }> | null = null;

function walkCorpusAttackFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walkCorpusAttackFiles(p, acc);
    else if (name.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

/** Load authentic corpus attack fixtures for LLM schema context. */
export function loadCorpusSamples(opts?: {
  category?: string;
  limit?: number;
}): Array<CorpusCandidate & { relPath: string }> {
  if (!corpusSamplesCache) {
    corpusSamplesCache = walkCorpusAttackFiles(CORPUS_ATTACKS_ROOT).map((p) => {
      const raw = JSON.parse(readFileSync(p, 'utf-8')) as CorpusCandidate;
      return {
        id: raw.id || p.split('/').pop()?.replace('.json', '') || 'corpus',
        toolName: raw.toolName,
        arguments: raw.arguments ?? {},
        expected: raw.expected || 'block',
        category: raw.category,
        ruleHint: raw.ruleHint,
        relPath: p.replace(`${process.cwd()}/`, ''),
      };
    });
  }
  let pool = corpusSamplesCache;
  if (opts?.category) {
    const cat = opts.category.toLowerCase();
    const matched = pool.filter((s) => s.category.toLowerCase().includes(cat.split('-')[0] || cat));
    if (matched.length) pool = matched;
  }
  const limit = opts?.limit ?? pool.length;
  return pool.slice(0, limit);
}

/** Records synthesized by calibrate-semantic seed — not authentic async semantic audits. */
export function isCalibratorSeededRecord(record: StoredSemanticAudit): boolean {
  if ((record.semanticAudit?.reasoning || '').startsWith(CALIBRATOR_SEED_PREFIX)) return true;
  if (record.labelUserId === 'swarm-calibrator') return true;
  return false;
}

/** Human or proxy-originated semantic true-positive suitable for Threat Lab. */
export function isAuthenticSemanticTp(record: StoredSemanticAudit): boolean {
  return record.label === 'true_positive' && !isCalibratorSeededRecord(record);
}

export function threatLabRequireLlm(): boolean {
  return process.env.SWARM_THREAT_LAB_REQUIRE_LLM !== 'false';
}

export function threatLabLlmConfig(): Partial<import('./llm-assistant.js').LlmAssistantConfig> {
  const timeoutMs = parseInt(process.env.SWARM_THREAT_LAB_LLM_TIMEOUT_MS || '120000', 10);
  const maxTokens = parseInt(process.env.SWARM_THREAT_LAB_LLM_MAX_TOKENS || '2048', 10);
  return {
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 2048,
    hotPath: false,
  };
}

export async function ensureThreatLabLlmReady(
  llm?: LlmAssistant,
): Promise<{ ok: boolean; llm: LlmAssistant; reason?: string }> {
  const assistant = llm ?? new LlmAssistant(threatLabLlmConfig());
  if (!assistant.isAvailable()) {
    return {
      ok: false,
      llm: assistant,
      reason: 'LLM disabled — set GUARDIAN_LLM_ENABLED=true and configure Ollama',
    };
  }
  const maxAttempts = 3;
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const health = await assistant.healthCheckDetailed();
    if (health.ok) return { ok: true, llm: assistant };
    lastReason = health.reason || 'unknown';
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  return {
    ok: false,
    llm: assistant,
    reason: `Ollama unreachable (${lastReason}) at ${assistant.getOllamaUrl()} — start Ollama and verify OLLAMA_BASE_URL`,
  };
}

export function validateCorpusCandidateSchema(candidate: unknown): string[] {
  const errors: string[] = [];
  if (!candidate || typeof candidate !== 'object') {
    return ['corpusCandidate must be an object'];
  }
  const c = candidate as Record<string, unknown>;
  if (typeof c.toolName !== 'string' || !c.toolName.trim()) {
    errors.push('corpusCandidate.toolName required');
  }
  if (c.arguments !== undefined && (typeof c.arguments !== 'object' || c.arguments === null)) {
    errors.push('corpusCandidate.arguments must be an object');
  }
  if (c.expected !== undefined && c.expected !== 'block' && c.expected !== 'pass') {
    errors.push('corpusCandidate.expected must be block or pass');
  }
  if (typeof c.category !== 'string' || !c.category.trim()) {
    errors.push('corpusCandidate.category required');
  }
  return errors;
}

export function validatePolicyRuleSafe(rule: PolicyRule): string[] {
  const errors: string[] = [];
  if (!rule.name?.trim()) errors.push('policyRule.name required');
  if (!['block', 'flag', 'pass'].includes(rule.action)) {
    errors.push('policyRule.action must be block, flag, or pass');
  }
  const patterns = [...(rule.patterns || [])];
  for (const ap of rule.argPatterns || []) {
    patterns.push(...ap.patterns);
  }
  for (const p of patterns) {
    if (isDangerousUnblockPattern(rule.name, p)) {
      errors.push(`dangerous unblock pattern: ${p}`);
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(p);
    } catch {
      errors.push(`invalid regex: ${p}`);
    }
  }
  return errors;
}

/** Smoke-test: attack fixtures should be blocked by corpus replay policy (default-policy.yaml by default). */
export function evaluateCorpusFixture(
  candidate: CorpusCandidate,
  engine?: PolicyEngine | null,
): { blocked: boolean; rule?: string } {
  const eng = engine ?? loadCorpusReplayPolicyEngine();
  if (!eng) return { blocked: false };
  resetSessionFlowHistory();
  const decision = eng.evaluate(
    evalCtx(candidate.toolName, (candidate.arguments ?? {}) as Record<string, unknown>),
  );
  return { blocked: decision.action === 'block', rule: decision.rule };
}

export function validateThreatLabDiscovery(
  discovery: ThreatLabDiscovery,
  opts?: { requireReplayBlock?: boolean },
): ThreatLabValidationResult {
  const errors: string[] = [
    ...validateCorpusCandidateSchema(discovery.corpusCandidate),
    ...validatePolicyRuleSafe(discovery.policyRule),
  ];
  if (!discovery.attackClass?.trim()) errors.push('attackClass required');
  if (discovery.attackClass.startsWith('llm-fallback')) {
    errors.push('synthetic fallback attackClass rejected');
  }
  if (typeof discovery.confidence !== 'number' || discovery.confidence < 0 || discovery.confidence > 1) {
    errors.push('confidence must be 0-1');
  }

  let replayBlocked: boolean | undefined;
  if (discovery.corpusCandidate.expected === 'block') {
    const replay = evaluateCorpusFixture(discovery.corpusCandidate);
    replayBlocked = replay.blocked;
    if (opts?.requireReplayBlock && !replay.blocked) {
      errors.push('corpus fixture not blocked by current policy (replay smoke test failed)');
    }
  }

  return { ok: errors.length === 0, errors, replayBlocked };
}

export function parseDiscoveryJson(text: string): ThreatLabDiscovery | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as ThreatLabDiscovery;
    if (!parsed.corpusCandidate || !parsed.policyRule) return null;
    parsed.corpusCandidate.expected = parsed.corpusCandidate.expected || 'block';
    if (parsed.policyRule.patterns) {
      parsed.policyRule.patterns = parsed.policyRule.patterns.map((p) =>
        p.replace(/^\(\?i\)/, '').replace(/^\(\?i:/, '').replace(/\(\?i\)/g, ''),
      );
    }
    return parsed;
  } catch {
    return null;
  }
}

function redactBypassContext(bypass: BypassContext): Record<string, unknown> {
  const args = (bypass.arguments || bypass.args) as Record<string, unknown> | undefined;
  return {
    fingerprint: bypass.fingerprint,
    toolName: bypass.toolName || bypass.tool,
    category: bypass.category || bypass.ruleHint,
    payload: String(bypass.payload || bypass.block_reason || bypass.reason || '').slice(0, 400),
    arguments: args ? redactArguments(args) : undefined,
    argumentKeys: args ? Object.keys(args) : [],
  };
}

function redactArguments(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string') out[k] = v.slice(0, 400);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (v && typeof v === 'object') out[k] = '[object]';
  }
  return out;
}

function pickCorpusExamples(category?: string, limit = 3): Array<Record<string, unknown>> {
  return loadCorpusSamples({ category, limit }).map((s) => ({
    relPath: s.relPath,
    toolName: s.toolName,
    arguments: s.arguments,
    category: s.category,
    expected: s.expected,
    ruleHint: s.ruleHint,
  }));
}

async function enrichPolicyRuleFromLlm(
  llm: LlmAssistant,
  discovery: ThreatLabDiscovery,
  availableTools: string[],
): Promise<ThreatLabDiscovery> {
  const hasPatterns =
    (discovery.policyRule.patterns?.length ?? 0) > 0 ||
    (discovery.policyRule.argPatterns?.length ?? 0) > 0;
  if (hasPatterns) return discovery;

  const goal = `${discovery.hypothesis}. Block ${discovery.corpusCandidate.category} on tool ${discovery.corpusCandidate.toolName}.`;
  const generated = await llm.generatePolicyRule(goal, availableTools);
  if (!generated?.yaml) return discovery;

  try {
    const parsed = load(generated.yaml) as PolicyRule | { rules?: PolicyRule[] };
    const rule = Array.isArray((parsed as { rules?: PolicyRule[] }).rules)
      ? (parsed as { rules: PolicyRule[] }).rules[0]
      : (parsed as PolicyRule);
    if (rule?.name && rule.action) {
      return {
        ...discovery,
        policyRule: {
          ...discovery.policyRule,
          name: rule.name,
          description: rule.description || discovery.policyRule.description,
          action: rule.action,
          patterns: rule.patterns || discovery.policyRule.patterns,
          argPatterns: rule.argPatterns || discovery.policyRule.argPatterns,
          tools: rule.tools || discovery.policyRule.tools,
        },
      };
    }
  } catch {
    Logger.debug('[ThreatLab] generatePolicyRule YAML parse failed — keeping discovery policyRule');
  }
  return discovery;
}

interface DiscoverContext {
  bypass?: BypassContext;
  corpusSeed?: CorpusCandidate & { relPath?: string };
  threatEntry?: ThreatIntelEntry;
  semanticRecord?: StoredSemanticAudit;
  seq?: number;
}

async function discoverViaLlm(
  llm: LlmAssistant,
  ctx: DiscoverContext,
): Promise<ThreatLabDiscovery | null> {
  const category =
    ctx.bypass?.category ||
    ctx.corpusSeed?.category ||
    ctx.threatEntry?.signature ||
    ctx.semanticRecord?.semanticAudit?.categories?.[0];
  const corpusExamples = pickCorpusExamples(category, 3);
  const availableTools = [
    ctx.bypass?.toolName || ctx.bypass?.tool,
    ctx.corpusSeed?.toolName,
    ctx.semanticRecord?.toolName,
  ].filter(Boolean) as string[];

  const userPrompt = JSON.stringify({
    bypass: ctx.bypass ? redactBypassContext(ctx.bypass) : undefined,
    corpusSeed: ctx.corpusSeed
      ? {
          relPath: ctx.corpusSeed.relPath,
          toolName: ctx.corpusSeed.toolName,
          arguments: redactArguments(ctx.corpusSeed.arguments ?? {}),
          category: ctx.corpusSeed.category,
        }
      : undefined,
    threatIntel: ctx.threatEntry
      ? {
          id: ctx.threatEntry.id,
          severity: ctx.threatEntry.severity,
          description: ctx.threatEntry.description.slice(0, 400),
          affectedPackage: ctx.threatEntry.affectedPackage,
          signature: ctx.threatEntry.signature,
        }
      : undefined,
    semanticAudit: ctx.semanticRecord
      ? {
          id: ctx.semanticRecord.id,
          toolName: ctx.semanticRecord.toolName,
          categories: ctx.semanticRecord.semanticAudit?.categories,
          reasoning: ctx.semanticRecord.semanticAudit?.reasoning?.slice(0, 400),
          syncDecision: ctx.semanticRecord.syncDecision?.action,
        }
      : undefined,
    corpusSchemaExamples: corpusExamples,
    seq: ctx.seq ?? 1,
    instruction:
      'Propose a novel evasion variant grounded in the supplied authentic context. Use real argument shapes from corpus examples.',
  });

  const result = await llm.generate(DISCOVERY_SYSTEM_PROMPT, userPrompt);
  if (!result?.text) return null;

  const parsed = parseDiscoveryJson(result.text);
  if (!parsed) {
    Logger.debug('[ThreatLab] LLM response failed schema parse');
    return null;
  }

  if (!parsed.corpusCandidate.id) {
    parsed.corpusCandidate.id = `threat-lab-${String(ctx.seq ?? 1).padStart(3, '0')}`;
  }

  return enrichPolicyRuleFromLlm(llm, parsed, availableTools);
}

export async function discoverFromBypass(
  bypass: BypassContext,
  opts?: { llm?: LlmAssistant; seq?: number },
): Promise<ThreatLabDiscovery | null> {
  const ready = await ensureThreatLabLlmReady(opts?.llm);
  if (!ready.ok) {
    if (threatLabRequireLlm()) {
      Logger.debug(`[ThreatLab] skip bypass discovery: ${ready.reason}`);
      return null;
    }
    return null;
  }
  return discoverViaLlm(ready.llm, { bypass, seq: opts?.seq ?? 1 });
}

export function semanticFlagMinConfidence(): number {
  const n = parseFloat(process.env.GUARDIAN_THREAT_RESEARCH_SEMANTIC_MIN_CONFIDENCE || '0.85');
  return Number.isFinite(n) ? n : 0.85;
}

/** High-confidence async semantic flag — no human TP label required (auto threat research). */
export async function discoverFromSemanticFlag(
  record: StoredSemanticAudit,
  opts?: { llm?: LlmAssistant; seq?: number },
): Promise<ThreatLabDiscovery | null> {
  if (isCalibratorSeededRecord(record)) return null;
  if (!record.semanticAudit?.suspicious) return null;
  if ((record.semanticAudit.confidence ?? 0) < semanticFlagMinConfidence()) return null;

  const bypass: BypassContext = {
    fingerprint: record.id,
    toolName: record.toolName,
    category: record.semanticAudit?.categories?.[0] || 'semantic-flag',
    payload: record.semanticAudit?.reasoning?.slice(0, 400),
    block_reason: record.syncDecision?.reason,
  };
  const ready = await ensureThreatLabLlmReady(opts?.llm);
  if (!ready.ok) return null;
  return discoverViaLlm(ready.llm, { bypass, semanticRecord: record, seq: opts?.seq ?? 1 });
}

export async function discoverFromSemanticAudit(
  record: StoredSemanticAudit,
  opts?: { llm?: LlmAssistant; seq?: number },
): Promise<ThreatLabDiscovery | null> {
  if (record.label !== 'true_positive' || isCalibratorSeededRecord(record)) return null;

  const bypass: BypassContext = {
    fingerprint: record.id,
    toolName: record.toolName,
    category: record.semanticAudit?.categories?.[0] || 'semantic-flag',
    payload: record.semanticAudit?.reasoning?.slice(0, 400),
    block_reason: record.syncDecision?.reason,
  };
  const ready = await ensureThreatLabLlmReady(opts?.llm);
  if (!ready.ok) return null;
  return discoverViaLlm(ready.llm, { bypass, semanticRecord: record, seq: opts?.seq ?? 1 });
}

export async function discoverFromThreatIntel(
  entry: ThreatIntelEntry,
  opts?: { llm?: LlmAssistant; seq?: number },
): Promise<ThreatLabDiscovery | null> {
  const ready = await ensureThreatLabLlmReady(opts?.llm);
  if (!ready.ok) return null;

  const llm = ready.llm;
  const analysis = await llm.analyzeThreat({
    cveId: entry.id.replace(/^nvd-/, ''),
    severity: entry.severity,
    description: entry.description,
    affectedPackage: entry.affectedPackage || 'unknown',
  });

  if (analysis?.suggestedPatterns?.length) {
    const seq = opts?.seq ?? 1;
    const slug = entry.id.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 24);
    const discovery: ThreatLabDiscovery = {
      attackClass: `cve-${slug}`,
      hypothesis: analysis.impact || entry.description.slice(0, 120),
      corpusCandidate: {
        id: `threat-lab-cve-${String(seq).padStart(3, '0')}`,
        toolName: entry.affectedPackage?.includes('filesystem') ? 'read_text_file' : 'search',
        arguments: { query: entry.description.slice(0, 200) },
        expected: 'block',
        category: 'threat-intel',
        ruleHint: entry.signature || 'threat-intel',
      },
      policyRule: {
        name: `threat-intel-${slug}`,
        description: `[${entry.severity}] ${entry.description.slice(0, 200)}`,
        action: analysis.action === 'pass' ? 'flag' : 'block',
        patterns: analysis.suggestedPatterns.slice(0, 3),
      },
      confidence: entry.severity === 'CRITICAL' ? 0.9 : entry.severity === 'HIGH' ? 0.85 : 0.75,
    };
    return enrichPolicyRuleFromLlm(llm, discovery, [discovery.corpusCandidate.toolName]);
  }

  return discoverViaLlm(llm, { threatEntry: entry, seq: opts?.seq ?? 1 });
}

/** Proactive red-team: mutate an authentic corpus attack fixture via LLM (no synthetic payloads). */
export async function discoverFromCorpusSeed(
  seed: CorpusCandidate & { relPath?: string },
  opts?: { llm?: LlmAssistant; seq?: number },
): Promise<ThreatLabDiscovery | null> {
  const ready = await ensureThreatLabLlmReady(opts?.llm);
  if (!ready.ok) return null;
  return discoverViaLlm(ready.llm, { corpusSeed: seed, seq: opts?.seq ?? 1 });
}

export function threatLabMaxCandidates(): number {
  const n = parseInt(process.env.SWARM_THREAT_LAB_MAX || '10', 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function threatLabEnabled(): boolean {
  return process.env.SWARM_THREAT_LAB === 'true';
}

export function threatLabMode(): 'reactive' | 'proactive' {
  return process.env.SWARM_THREAT_LAB_MODE === 'proactive' ? 'proactive' : 'reactive';
}

export function threatLabSemanticEnabled(): boolean {
  return process.env.SWARM_THREAT_LAB_SEMANTIC !== 'false';
}
