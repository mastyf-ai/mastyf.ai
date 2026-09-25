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
import { parsePolicyConfig } from '../policy/policy-schema.js';
import { resetSessionFlowHistory } from '../policy/session-flow-store.js';
import { Logger } from '../utils/logger.js';
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
function defaultPolicyPath() {
    return process.env.MASTYF_AI_POLICY_PATH || DEFAULT_POLICY_PATH;
}
/** Policy used for corpus fixture replay validation (independent of live proxy policy). */
export function corpusReplayPolicyPath() {
    return process.env.MASTYF_AI_CORPUS_REPLAY_POLICY_PATH || DEFAULT_POLICY_PATH;
}
function loadPolicyEngineFromPath(path) {
    if (!existsSync(path))
        return null;
    try {
        const policy = parsePolicyConfig(load(readFileSync(path, 'utf-8')));
        return new PolicyEngine(policy);
    }
    catch {
        return null;
    }
}
function loadPolicyEngine() {
    return loadPolicyEngineFromPath(defaultPolicyPath());
}
export function loadCorpusReplayPolicyEngine() {
    return loadPolicyEngineFromPath(corpusReplayPolicyPath());
}
function evalCtx(toolName, args) {
    return {
        serverName: 'threat-lab',
        toolName,
        arguments: args,
        requestId: 'threat-lab-1',
        requestTokens: 50,
        timestamp: new Date().toISOString(),
    };
}
let corpusSamplesCache = null;
function walkCorpusAttackFiles(dir, acc = []) {
    if (!existsSync(dir))
        return acc;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory())
            walkCorpusAttackFiles(p, acc);
        else if (name.name.endsWith('.json'))
            acc.push(p);
    }
    return acc;
}
/** Load authentic corpus attack fixtures for LLM schema context. */
export function loadCorpusSamples(opts) {
    if (!corpusSamplesCache) {
        corpusSamplesCache = walkCorpusAttackFiles(CORPUS_ATTACKS_ROOT).map((p) => {
            const raw = JSON.parse(readFileSync(p, 'utf-8'));
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
        if (matched.length)
            pool = matched;
    }
    const limit = opts?.limit ?? pool.length;
    return pool.slice(0, limit);
}
/** Records synthesized by calibrate-semantic seed — not authentic async semantic audits. */
export function isCalibratorSeededRecord(record) {
    if ((record.semanticAudit?.reasoning || '').startsWith(CALIBRATOR_SEED_PREFIX))
        return true;
    if (record.labelUserId === 'swarm-calibrator')
        return true;
    return false;
}
/** Human or proxy-originated semantic true-positive suitable for Threat Lab. */
export function isAuthenticSemanticTp(record) {
    return record.label === 'true_positive' && !isCalibratorSeededRecord(record);
}
export function threatLabRequireLlm() {
    return process.env.SWARM_THREAT_LAB_REQUIRE_LLM !== 'false';
}
export function threatLabLlmConfig() {
    const timeoutMs = parseInt(process.env.SWARM_THREAT_LAB_LLM_TIMEOUT_MS || '120000', 10);
    const maxTokens = parseInt(process.env.SWARM_THREAT_LAB_LLM_MAX_TOKENS || '2048', 10);
    return {
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
        maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 2048,
        hotPath: false,
    };
}
let threatLabHealthCache = null;
const THREAT_LAB_HEALTH_TTL_MS = 5 * 60 * 1000;
export async function ensureThreatLabLlmReady(llm) {
    const assistant = llm ?? new LlmAssistant(threatLabLlmConfig());
    if (!assistant.isAvailable()) {
        return {
            ok: false,
            llm: assistant,
            reason: 'LLM disabled — set MASTYF_AI_LLM_ENABLED=true and configure Ollama',
        };
    }
    const useProcessCache = llm === undefined;
    if (useProcessCache &&
        threatLabHealthCache &&
        Date.now() - threatLabHealthCache.at < THREAT_LAB_HEALTH_TTL_MS &&
        threatLabHealthCache.ok) {
        return { ok: true, llm: assistant };
    }
    const maxAttempts = parseInt(process.env.MASTYF_AI_THREAT_LAB_HEALTH_ATTEMPTS || '2', 10);
    let lastReason = 'unknown';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const health = await assistant.healthCheckDetailed();
        if (health.ok) {
            if (useProcessCache)
                threatLabHealthCache = { ok: true, at: Date.now() };
            return { ok: true, llm: assistant };
        }
        lastReason = health.reason || 'unknown';
        if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
    }
    if (useProcessCache)
        threatLabHealthCache = { ok: false, at: Date.now(), reason: lastReason };
    return {
        ok: false,
        llm: assistant,
        reason: `Ollama unreachable (${lastReason}) at ${assistant.getOllamaUrl()} — start Ollama and verify OLLAMA_BASE_URL`,
    };
}
export function validateCorpusCandidateSchema(candidate) {
    const errors = [];
    if (!candidate || typeof candidate !== 'object') {
        return ['corpusCandidate must be an object'];
    }
    const c = candidate;
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
export function validatePolicyRuleSafe(rule) {
    const errors = [];
    if (!rule.name?.trim())
        errors.push('policyRule.name required');
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
        }
        catch {
            errors.push(`invalid regex: ${p}`);
        }
    }
    return errors;
}
/** Smoke-test: attack fixtures should be blocked by corpus replay policy (default-policy.yaml by default). */
export function evaluateCorpusFixture(candidate, engine) {
    const eng = engine ?? loadCorpusReplayPolicyEngine();
    if (!eng)
        return { blocked: false };
    resetSessionFlowHistory();
    const decision = eng.evaluate(evalCtx(candidate.toolName, (candidate.arguments ?? {})));
    return { blocked: decision.action === 'block', rule: decision.rule };
}
export function validateThreatLabDiscovery(discovery, opts) {
    const errors = [
        ...validateCorpusCandidateSchema(discovery.corpusCandidate),
        ...validatePolicyRuleSafe(discovery.policyRule),
    ];
    if (!discovery.attackClass?.trim())
        errors.push('attackClass required');
    if (discovery.attackClass.startsWith('llm-fallback')) {
        errors.push('synthetic fallback attackClass rejected');
    }
    if (typeof discovery.confidence !== 'number' || discovery.confidence < 0 || discovery.confidence > 1) {
        errors.push('confidence must be 0-1');
    }
    let replayBlocked;
    if (discovery.corpusCandidate.expected === 'block') {
        const replay = evaluateCorpusFixture(discovery.corpusCandidate);
        replayBlocked = replay.blocked;
        if (opts?.requireReplayBlock && !replay.blocked) {
            errors.push('corpus fixture not blocked by current policy (replay smoke test failed)');
        }
    }
    return { ok: errors.length === 0, errors, replayBlocked };
}
export function parseDiscoveryJson(text) {
    const trimmed = text.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch)
        return null;
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.corpusCandidate || !parsed.policyRule)
            return null;
        parsed.corpusCandidate.expected = parsed.corpusCandidate.expected || 'block';
        if (parsed.policyRule.patterns) {
            parsed.policyRule.patterns = parsed.policyRule.patterns.map((p) => p.replace(/^\(\?i\)/, '').replace(/^\(\?i:/, '').replace(/\(\?i\)/g, ''));
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function redactBypassContext(bypass) {
    const args = (bypass.arguments || bypass.args);
    return {
        fingerprint: bypass.fingerprint,
        toolName: bypass.toolName || bypass.tool,
        category: bypass.category || bypass.ruleHint,
        payload: String(bypass.payload || bypass.block_reason || bypass.reason || '').slice(0, 400),
        arguments: args ? redactArguments(args) : undefined,
        argumentKeys: args ? Object.keys(args) : [],
    };
}
function redactArguments(args) {
    const out = {};
    for (const [k, v] of Object.entries(args)) {
        if (typeof v === 'string')
            out[k] = v.slice(0, 400);
        else if (typeof v === 'number' || typeof v === 'boolean')
            out[k] = v;
        else if (v && typeof v === 'object')
            out[k] = '[object]';
    }
    return out;
}
function pickCorpusExamples(category, limit = 3) {
    return loadCorpusSamples({ category, limit }).map((s) => ({
        relPath: s.relPath,
        toolName: s.toolName,
        arguments: s.arguments,
        category: s.category,
        expected: s.expected,
        ruleHint: s.ruleHint,
    }));
}
async function enrichPolicyRuleFromLlm(llm, discovery, availableTools) {
    const hasPatterns = (discovery.policyRule.patterns?.length ?? 0) > 0 ||
        (discovery.policyRule.argPatterns?.length ?? 0) > 0;
    if (hasPatterns)
        return discovery;
    const goal = `${discovery.hypothesis}. Block ${discovery.corpusCandidate.category} on tool ${discovery.corpusCandidate.toolName}.`;
    const generated = await llm.generatePolicyRule(goal, availableTools);
    if (!generated?.yaml)
        return discovery;
    try {
        const parsed = load(generated.yaml);
        const rule = Array.isArray(parsed.rules)
            ? parsed.rules[0]
            : parsed;
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
    }
    catch {
        Logger.debug('[ThreatLab] generatePolicyRule YAML parse failed — keeping discovery policyRule');
    }
    return discovery;
}
async function discoverViaLlm(llm, ctx) {
    const category = ctx.bypass?.category ||
        ctx.corpusSeed?.category ||
        ctx.threatEntry?.signature ||
        ctx.semanticRecord?.semanticAudit?.categories?.[0];
    const corpusExamples = pickCorpusExamples(category, 3);
    const availableTools = [
        ctx.bypass?.toolName || ctx.bypass?.tool,
        ctx.corpusSeed?.toolName,
        ctx.semanticRecord?.toolName,
    ].filter(Boolean);
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
        instruction: 'Propose a novel evasion variant grounded in the supplied authentic context. Use real argument shapes from corpus examples.',
    });
    const result = await llm.generate(DISCOVERY_SYSTEM_PROMPT, userPrompt);
    if (!result?.text)
        return null;
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
/** Batched variant — one LLM call returns N candidates (array JSON), validated individually. */
export async function discoverBatchViaLlm(llm, ctx, count) {
    const n = Math.max(1, Math.min(count, 10));
    const single = await discoverViaLlm(llm, ctx);
    if (n === 1)
        return single ? [single] : [];
    // Try batched prompt
    try {
        const userPrompt = JSON.stringify({
            context: 'Batched discovery — return array',
            count: n,
            bypass: ctx.bypass ? redactBypassContext(ctx.bypass) : undefined,
            corpusSeed: ctx.corpusSeed ? { toolName: ctx.corpusSeed.toolName, category: ctx.corpusSeed.category } : undefined,
        });
        const systemBatched = DISCOVERY_SYSTEM_PROMPT + `\nReturn ONLY a JSON array of ${n} objects with the same schema as the single discovery (attackClass, hypothesis, corpusCandidate, policyRule, confidence). No surrounding object.`;
        const result = await llm.generate(systemBatched, userPrompt);
        if (!result?.text)
            return single ? [single] : [];
        const arr = JSON.parse(result.text.match(/\[[\s\S]*\]/)?.[0] || '[]');
        const out = [];
        for (let i = 0; i < arr.length && out.length < n; i++) {
            const parsed = parseDiscoveryJson(JSON.stringify(arr[i]));
            if (!parsed)
                continue;
            if (!parsed.corpusCandidate.id)
                parsed.corpusCandidate.id = `threat-lab-${String((ctx.seq ?? 1) + i).padStart(3, '0')}`;
            out.push(await enrichPolicyRuleFromLlm(llm, parsed, []));
        }
        if (out.length)
            return out;
    }
    catch { /* fallback to single */ }
    return single ? [single] : [];
}
export async function discoverFromBypass(bypass, opts) {
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
export function semanticFlagMinConfidence() {
    const n = parseFloat(process.env.MASTYF_AI_THREAT_RESEARCH_SEMANTIC_MIN_CONFIDENCE || '0.85');
    return Number.isFinite(n) ? n : 0.85;
}
/** High-confidence async semantic flag — no human TP label required (auto threat research). */
export async function discoverFromSemanticFlag(record, opts) {
    if (isCalibratorSeededRecord(record))
        return null;
    if (!record.semanticAudit?.suspicious)
        return null;
    if ((record.semanticAudit.confidence ?? 0) < semanticFlagMinConfidence())
        return null;
    const bypass = {
        fingerprint: record.id,
        toolName: record.toolName,
        category: record.semanticAudit?.categories?.[0] || 'semantic-flag',
        payload: record.semanticAudit?.reasoning?.slice(0, 400),
        block_reason: record.syncDecision?.reason,
    };
    const ready = await ensureThreatLabLlmReady(opts?.llm);
    if (!ready.ok)
        return null;
    return discoverViaLlm(ready.llm, { bypass, semanticRecord: record, seq: opts?.seq ?? 1 });
}
export async function discoverFromSemanticAudit(record, opts) {
    if (record.label !== 'true_positive' || isCalibratorSeededRecord(record))
        return null;
    const bypass = {
        fingerprint: record.id,
        toolName: record.toolName,
        category: record.semanticAudit?.categories?.[0] || 'semantic-flag',
        payload: record.semanticAudit?.reasoning?.slice(0, 400),
        block_reason: record.syncDecision?.reason,
    };
    const ready = await ensureThreatLabLlmReady(opts?.llm);
    if (!ready.ok)
        return null;
    return discoverViaLlm(ready.llm, { bypass, semanticRecord: record, seq: opts?.seq ?? 1 });
}
export async function discoverFromThreatIntel(entry, opts) {
    const ready = await ensureThreatLabLlmReady(opts?.llm);
    if (!ready.ok)
        return null;
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
        const discovery = {
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
export async function discoverFromCorpusSeed(seed, opts) {
    const ready = await ensureThreatLabLlmReady(opts?.llm);
    if (!ready.ok)
        return null;
    return discoverViaLlm(ready.llm, { corpusSeed: seed, seq: opts?.seq ?? 1 });
}
export function threatLabMaxCandidates() {
    const n = parseInt(process.env.SWARM_THREAT_LAB_MAX || '10', 10);
    return Number.isFinite(n) && n > 0 ? n : 10;
}
export function threatLabEnabled() {
    return process.env.SWARM_THREAT_LAB === 'true';
}
export function threatLabMode() {
    return process.env.SWARM_THREAT_LAB_MODE === 'proactive' ? 'proactive' : 'reactive';
}
export function threatLabSemanticEnabled() {
    return process.env.SWARM_THREAT_LAB_SEMANTIC !== 'false';
}
/**
 * Discover attack probes / policy mitigations from a VulnFinding (unpublished vuln discovery).
 */
export async function discoverFromVulnFinding(finding, opts) {
    const ready = await ensureThreatLabLlmReady(opts?.llm);
    if (!ready.ok)
        return null;
    const toolName = finding.target.name.includes(':')
        ? finding.target.name.split(':').pop()
        : 'search';
    const contextNote = [
        `VulnFinding ${finding.id} (${finding.severity}/${finding.class})`,
        finding.description.slice(0, 300),
        finding.analysisExecutiveSummary?.slice(0, 400) || '',
        finding.exploitScenario?.slice(0, 400) || '',
        `scanner=${finding.evidence.scanner}`,
        ...finding.evidence.reproSteps.slice(0, 5),
    ]
        .filter(Boolean)
        .join('\n');
    const bypass = {
        fingerprint: finding.id,
        toolName,
        tool: toolName,
        category: finding.class,
        reason: finding.title,
        block_reason: finding.title,
        payload: contextNote.slice(0, 800),
        arguments: { query: finding.evidence.reproSteps[0] || finding.title },
    };
    return discoverViaLlm(ready.llm, { bypass, seq: opts?.seq ?? 1 });
}
//# sourceMappingURL=threat-lab.js.map