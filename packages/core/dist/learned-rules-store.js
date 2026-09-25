import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { learnedRulesEnabled, learnedRulesMaxTotal, learnedRulesPath, learnedRulesReloadMs, } from "./learned-rules-config.js";
import { validateLearnedRule } from "./validate-learned-rule.js";
import { reloadArgumentInjectionRules } from "./argument-prompt-injection.js";
import { hasLearnedRulesSigningKey, readLearnedRulesSignatureEnvelope, signLearnedRulesJson, validateSignedLearnedRulesJson, writeLearnedRulesSignatureEnvelope, isLearnedRulesSignatureRequired, } from "./learned-rules-signature.js";
let cachedRules = [];
let reloadTimer = null;
/** Test override for overlay path. */
let pathOverride = null;
let localSemanticCacheBust = null;
export class LearnedRulesSignatureError extends Error {
    constructor(message) {
        super(message);
        this.name = "LearnedRulesSignatureError";
    }
}
/** Register cache bust hook from local-semantic-fallback (avoids circular import). */
export function registerLocalSemanticCacheBust(fn) {
    localSemanticCacheBust = fn;
}
function bustLearnedRuleCaches() {
    reloadArgumentInjectionRules();
    localSemanticCacheBust?.();
}
function storePath() {
    return pathOverride ?? learnedRulesPath();
}
function emptyFile() {
    return { version: 1, updatedAt: new Date().toISOString(), rules: [] };
}
function readFile() {
    const path = storePath();
    if (!existsSync(path))
        return emptyFile();
    try {
        const raw = readFileSync(path, "utf-8");
        const envelope = readLearnedRulesSignatureEnvelope(path);
        const sigResult = validateSignedLearnedRulesJson(raw, envelope);
        if (!sigResult.ok) {
            const msg = `learned rules signature invalid: ${sigResult.reason}`;
            if (isLearnedRulesSignatureRequired())
                throw new LearnedRulesSignatureError(msg);
            return emptyFile();
        }
        const parsed = JSON.parse(raw);
        if (parsed.version !== 1 || !Array.isArray(parsed.rules))
            return emptyFile();
        return parsed;
    }
    catch (err) {
        if (err instanceof LearnedRulesSignatureError)
            throw err;
        return emptyFile();
    }
}
function writeFile(data) {
    const path = storePath();
    const dir = dirname(path);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    data.updatedAt = new Date().toISOString();
    const json = JSON.stringify(data, null, 2);
    writeFileSync(path, json);
    if (hasLearnedRulesSigningKey()) {
        const keyId = process.env["MASTYF_AI_LEARNED_RULES_SIGNING_KEY_ID"] || "default";
        const issuer = process.env["MASTYF_AI_LEARNED_RULES_SIGNING_ISSUER"] || "mastyf-ai-admin";
        const envelope = signLearnedRulesJson(json, {
            alg: "Ed25519",
            issuer,
            keyId,
            issuedAt: new Date().toISOString(),
        });
        writeLearnedRulesSignatureEnvelope(path, envelope);
    }
}
function nextRuleId(target, existing) {
    const prefix = target === "argument" ? "MCPG-A-LRN-" : "MCPG-LOC-LRN-";
    let max = 0;
    for (const r of existing) {
        if (!r.id.startsWith(prefix))
            continue;
        const n = parseInt(r.id.slice(prefix.length), 10);
        if (Number.isFinite(n) && n > max)
            max = n;
    }
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
}
function fingerprint(rule) {
    return createHash("sha256").update(`${rule.target}\0${rule.regex}`).digest("hex").slice(0, 16);
}
/** Load overlay rules from disk into memory (no-op when disabled). */
export function reloadLearnedRules() {
    if (!learnedRulesEnabled()) {
        cachedRules = [];
        return cachedRules;
    }
    cachedRules = readFile().rules;
    bustLearnedRuleCaches();
    return cachedRules;
}
/** In-memory learned rules (after reload). */
export function listLearnedRules(target) {
    if (!learnedRulesEnabled())
        return [];
    if (cachedRules.length === 0 && learnedRulesEnabled()) {
        reloadLearnedRules();
    }
    return target ? cachedRules.filter((r) => r.target === target) : [...cachedRules];
}
export function getLearnedRulesStats() {
    const rules = listLearnedRules();
    return {
        enabled: learnedRulesEnabled(),
        total: rules.length,
        argument: rules.filter((r) => r.target === "argument").length,
        localSemantic: rules.filter((r) => r.target === "local-semantic").length,
    };
}
/** Append a validated rule to the overlay file. */
export function appendLearnedRule(draft, validateOpts) {
    if (!learnedRulesEnabled()) {
        return { ok: false, reason: "learned rules disabled" };
    }
    const validation = validateLearnedRule(draft, validateOpts);
    if (!validation.ok) {
        return { ok: false, reason: validation.errors.join("; ") };
    }
    const file = readFile();
    const fp = fingerprint(draft);
    if (file.rules.some((r) => fingerprint(r) === fp)) {
        return { ok: false, reason: "duplicate fingerprint" };
    }
    if (file.rules.length >= learnedRulesMaxTotal()) {
        return { ok: false, reason: "max total learned rules reached" };
    }
    const rule = {
        ...draft,
        id: draft.id ?? nextRuleId(draft.target, file.rules),
    };
    file.rules.push(rule);
    writeFile(file);
    cachedRules = file.rules;
    return { ok: true, rule };
}
/** Start periodic overlay reload; returns stop function. */
export function startLearnedRulesReloadTimer() {
    stopLearnedRulesReloadTimer();
    reloadLearnedRules();
    const ms = learnedRulesReloadMs();
    if (ms <= 0)
        return () => { };
    reloadTimer = setInterval(() => reloadLearnedRules(), ms);
    return stopLearnedRulesReloadTimer;
}
export function stopLearnedRulesReloadTimer() {
    if (reloadTimer) {
        clearInterval(reloadTimer);
        reloadTimer = null;
    }
}
/** @internal */
export function resetLearnedRulesForTests() {
    stopLearnedRulesReloadTimer();
    cachedRules = [];
    pathOverride = null;
}
/** @internal */
export function setLearnedRulesPathForTests(path) {
    pathOverride = path;
    cachedRules = [];
}
/** @internal */
export function writeLearnedRulesFileForTests(rules) {
    writeFile({ version: 1, updatedAt: new Date().toISOString(), rules });
    cachedRules = rules;
}
//# sourceMappingURL=learned-rules-store.js.map