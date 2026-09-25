/**
 * Continuous Live Red Team — PolicyEngine replay against corpus + persona proposals (safe shadow mode).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { buildThreatSignature } from '../utils/fleet-threat-signatures.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { loadCorpusSamples } from './threat-lab.js';
import { buildBypassEvent, processThreatResearchBatch } from './threat-research-pipeline.js';
const PERSONA_FILES = join(process.cwd(), 'reports', 'security-swarm', 'red-team-personas.json');
function defaultBaselinePath() {
    return join(process.cwd(), 'reports', 'security-swarm', 'tool-integrity-baseline.json');
}
function defaultReportPath() {
    return join(process.cwd(), 'reports', 'security-swarm', 'shadow-red-team.json');
}
function defaultPolicyPath() {
    return process.env.MASTYF_AI_POLICY_PATH || process.env.MASTYF_AI_POLICY_PATH || 'default-policy.yaml';
}
function loadPolicyEngine() {
    const path = defaultPolicyPath();
    if (!existsSync(path))
        return null;
    try {
        const config = load(readFileSync(path, 'utf-8'));
        return new PolicyEngine({ ...config, policy: { ...config.policy, mode: 'block' } });
    }
    catch {
        return null;
    }
}
export function loadToolBaseline(path) {
    const p = path || defaultBaselinePath();
    if (!existsSync(p))
        return [];
    try {
        const raw = JSON.parse(readFileSync(p, 'utf-8'));
        return Array.isArray(raw) ? raw : raw.servers || [];
    }
    catch {
        return [];
    }
}
function loadPersonaProposals() {
    if (!existsSync(PERSONA_FILES))
        return [];
    try {
        const raw = JSON.parse(readFileSync(PERSONA_FILES, 'utf-8'));
        return raw.proposals || [];
    }
    catch {
        return [];
    }
}
export function generateShadowProbes(baselines, limit = 32) {
    const cases = [];
    const toolSet = new Set();
    for (const b of baselines) {
        for (const t of b.toolNames)
            toolSet.add(`${b.serverName}:${t}`);
    }
    const corpus = loadCorpusSamples({ limit: 500 });
    for (const sample of corpus) {
        for (const baseline of baselines) {
            if (!baseline.toolNames.includes(sample.toolName))
                continue;
            const id = `shadow-corpus-${baseline.serverName}-${sample.id}`;
            cases.push({
                id,
                persona: sample.category,
                serverName: baseline.serverName,
                toolName: sample.toolName,
                arguments: sample.arguments,
                description: `Corpus fixture ${sample.id} (${sample.category})`,
                source: 'corpus',
            });
            if (cases.length >= limit)
                return cases;
        }
    }
    for (const p of loadPersonaProposals()) {
        const key = `${p.serverName}:${p.toolName}`;
        if (!toolSet.has(key) && !baselines.some((b) => b.serverName === p.serverName && b.toolNames.includes(p.toolName))) {
            continue;
        }
        cases.push({
            id: `shadow-persona-${p.persona}-${p.serverName}-${p.toolName}-${cases.length}`,
            persona: p.persona,
            serverName: p.serverName,
            toolName: p.toolName,
            arguments: { content: p.mutation, query: p.mutation, command: p.mutation },
            description: p.mutation,
            source: 'red_team_persona',
        });
        if (cases.length >= limit)
            return cases;
    }
    return cases;
}
export function runShadowProbes(probes, engine) {
    return probes.map((probe) => {
        const ctx = {
            serverName: probe.serverName,
            toolName: probe.toolName,
            arguments: probe.arguments,
            requestId: probe.id,
            requestTokens: 50,
            timestamp: new Date().toISOString(),
        };
        const decision = engine.evaluate(ctx);
        const wouldBlock = decision.action === 'block' || decision.action === 'flag';
        return {
            caseId: probe.id,
            persona: probe.persona,
            toolName: probe.toolName,
            serverName: probe.serverName,
            wouldBlock,
            matchedRule: decision.rule,
            action: decision.action,
            bypass: !wouldBlock,
            detail: wouldBlock ? `Blocked by ${decision.rule}` : `Passed (${decision.action}) — shadow bypass`,
        };
    });
}
function loadPreviousBypassIds() {
    const p = defaultReportPath();
    if (!existsSync(p))
        return new Set();
    try {
        const prev = JSON.parse(readFileSync(p, 'utf-8'));
        return new Set(prev.probes.filter((r) => r.bypass).map((r) => r.caseId));
    }
    catch {
        return new Set();
    }
}
export async function runShadowRedTeam(opts) {
    const startedAt = new Date().toISOString();
    const engine = loadPolicyEngine();
    const policyPath = defaultPolicyPath();
    const baselines = loadToolBaseline(opts?.baselinePath);
    const probes = generateShadowProbes(baselines, opts?.probeLimit ?? 32);
    const results = engine ? runShadowProbes(probes, engine) : [];
    const prevBypass = loadPreviousBypassIds();
    const bypasses = results.filter((r) => r.bypass);
    const newBypassRecords = bypasses.filter((r) => !prevBypass.has(r.caseId));
    let threatLabProcessed = 0;
    if (newBypassRecords.length > 0 && opts?.queueThreatLab !== false && process.env.SWARM_THREAT_LAB === 'true') {
        const events = newBypassRecords.map((b) => {
            const probe = probes.find((p) => p.id === b.caseId);
            return buildBypassEvent({
                fingerprint: `shadow:${b.caseId}`,
                toolName: b.toolName,
                category: b.persona,
                arguments: probe?.arguments,
                reason: b.detail,
            });
        });
        const results = await processThreatResearchBatch(events);
        threatLabProcessed = results.filter((r) => r.ok).length;
    }
    const run = {
        runId: `shadow-${Date.now()}`,
        startedAt,
        completedAt: new Date().toISOString(),
        baselineFingerprint: baselines.map((b) => b.fingerprint).join(','),
        policyPath,
        probes: results,
        bypassCount: bypasses.length,
        newBypasses: newBypassRecords.length,
        threatLabQueued: newBypassRecords.length > 0,
        threatLabProcessed,
    };
    if (opts?.writeReport !== false) {
        mkdirSync(join(process.cwd(), 'reports', 'security-swarm'), { recursive: true });
        writeFileSync(defaultReportPath(), JSON.stringify(run, null, 2));
    }
    return run;
}
export function shadowBypassThreatSignatures(run, probes) {
    return run.probes
        .filter((p) => p.bypass)
        .map((p) => {
        const probe = probes.find((x) => x.id === p.caseId);
        return buildThreatSignature({
            rule: p.matchedRule || 'shadow-bypass',
            tool: p.toolName,
            category: p.persona,
            argKeys: probe ? Object.keys(probe.arguments) : [],
        });
    });
}
//# sourceMappingURL=shadow-red-team.js.map