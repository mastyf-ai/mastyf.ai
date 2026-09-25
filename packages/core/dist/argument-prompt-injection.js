import { normalizeUnicode } from "./confusables.js";
import { tryDecodeVariants } from "./argument-decode.js";
import { execPattern } from "./safe-pattern-match.js";
import { isSafeUrlHost } from "./url-allowlist.js";
import { ARGUMENT_INJECTION_RULES } from "./argument-injection-rules.js";
import { listLearnedRules } from "./learned-rules-store.js";
let compiledRules = null;
function compileStaticRules() {
    return ARGUMENT_INJECTION_RULES.map((rule) => ({
        id: rule.id,
        severity: rule.severity,
        description: rule.description,
        pattern: new RegExp(rule.regex, "ims"),
    }));
}
function compileLearnedArgumentRules() {
    return listLearnedRules("argument").map((rule) => ({
        id: rule.id,
        severity: rule.severity === "critical" ? "critical" : "high",
        description: rule.message,
        pattern: new RegExp(rule.regex, "ims"),
        learned: true,
    }));
}
export function reloadArgumentInjectionRules() {
    compiledRules = null;
}
export function getArgumentInjectionRules() {
    if (!compiledRules) {
        compiledRules = [...compileStaticRules(), ...compileLearnedArgumentRules()];
    }
    return compiledRules;
}
function mapSeverity(severity) {
    return severity === "critical" ? "critical" : "warning";
}
function shouldSkipExfilRule(ruleId, matchText) {
    if (ruleId !== "exfiltration-url" && ruleId !== "exfiltration-send-to-url") {
        return false;
    }
    const urlMatch = matchText.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
    if (!urlMatch)
        return false;
    try {
        const host = new URL(urlMatch).hostname;
        return isSafeUrlHost(host);
    }
    catch {
        return false;
    }
}
function bodiesForScan(raw) {
    const normalized = normalizeUnicode(raw, true);
    const decoded = tryDecodeVariants(raw);
    return [...new Set([raw, normalized, ...decoded])];
}
function makePiIssue(rule, evidence) {
    return {
        id: `MCPG-A-PI-${rule.id}`,
        layer: "argument",
        severity: mapSeverity(rule.severity),
        category: "prompt-injection",
        message: rule.description,
        evidence: evidence.slice(0, 200),
        confidence: rule.severity === "critical" ? 0.92 : 0.85,
    };
}
/** Scan a single argument string leaf for prompt-injection patterns. */
export function scanArgumentPromptInjection(text) {
    if (!text.trim())
        return [];
    const issues = [];
    const seen = new Set();
    const bodies = bodiesForScan(text);
    for (const rule of getArgumentInjectionRules()) {
        for (const body of bodies) {
            const match = execPattern(rule.pattern, body);
            if (!match)
                continue;
            if (shouldSkipExfilRule(rule.id, match[0]))
                continue;
            const start = Math.max(0, match.index ?? 0);
            const snippet = body.slice(start, start + 120).replace(/\s+/g, " ").trim();
            const dedupKey = `${rule.id}:${snippet.slice(0, 80)}`;
            if (seen.has(dedupKey))
                break;
            seen.add(dedupKey);
            issues.push(makePiIssue(rule, snippet));
            break;
        }
    }
    return issues;
}
/** Exported for regex safety audit tests. */
export function getArgumentPromptInjectionPatterns() {
    return getArgumentInjectionRules().map((r) => r.pattern);
}
/** Quick predicate used by tests and smoke checks. */
export function matchesPromptInjection(text) {
    return scanArgumentPromptInjection(text).length > 0;
}
//# sourceMappingURL=argument-prompt-injection.js.map