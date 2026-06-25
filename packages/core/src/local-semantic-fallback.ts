import type { Issue, ToolDefinition } from "./types.js";
import {
  LOCAL_SEMANTIC_RULES,
  type LocalSemanticRuleDef,
} from "./local-semantic-rules.js";
import { execPattern } from "./safe-pattern-match.js";
import { extractHttpUrls, isSafeUrlHost } from "./url-allowlist.js";
import { listLearnedRules, reloadLearnedRules as reloadLearnedRulesStore } from "./learned-rules-store.js";
import { reloadArgumentInjectionRules } from "./argument-prompt-injection.js";

type CompiledLocalRule = LocalSemanticRuleDef & { re: RegExp; learned?: boolean };

let compiledRules: CompiledLocalRule[] | null = null;

function compileStaticLocalRules(): CompiledLocalRule[] {
  return LOCAL_SEMANTIC_RULES.map((rule) => ({
    ...rule,
    re: new RegExp(rule.regex, "ims"),
  }));
}

function compileLearnedLocalRules(): CompiledLocalRule[] {
  return listLearnedRules("local-semantic").map((rule) => ({
    id: rule.id,
    category: rule.category,
    severity: rule.severity,
    weight: rule.weight,
    regex: rule.regex,
    message: rule.message,
    re: new RegExp(rule.regex, "ims"),
    learned: true,
  }));
}

function getCompiledLocalRules(): CompiledLocalRule[] {
  if (!compiledRules) {
    compiledRules = [...compileStaticLocalRules(), ...compileLearnedLocalRules()];
  }
  return compiledRules;
}

/** @internal */
export function resetLocalSemanticRulesForTests(): void {
  compiledRules = null;
}

/** Reload learned overlay and bust compiled rule caches. */
export function reloadLearnedRules(): void {
  reloadLearnedRulesStore();
  compiledRules = null;
  reloadArgumentInjectionRules();
}

const THRESHOLD = (): number => {
  const n = parseFloat(process.env["MASTYF_AI_LOCAL_SEMANTIC_THRESHOLD"] || "0.55");
  return Number.isFinite(n) && n > 0 ? n : 0.55;
};

export function isCoreLocalSemanticEnabled(): boolean {
  const v = process.env["MASTYF_AI_LOCAL_SEMANTIC"];
  if (v === "false" || v === "0") return false;
  return true;
}

function shouldSkipExfilHit(ruleId: string, fullText: string): boolean {
  if (ruleId !== "MCPG-LOC-014" && ruleId !== "MCPG-LOC-015") {
    return false;
  }
  const urls = extractHttpUrls(fullText);
  if (urls.length === 0) return false;
  return urls.every((raw) => {
    try {
      return isSafeUrlHost(new URL(raw).hostname);
    } catch {
      return false;
    }
  });
}

/** Deterministic heuristic when no LLM API key is configured. */
export function runLocalSemanticFallback(
  tool: ToolDefinition,
): Issue[] {
  const text = `${tool.name}\n${tool.description ?? ""}`;
  let score = 0;
  const hits: Issue[] = [];

  for (const rule of getCompiledLocalRules()) {
    const m = execPattern(rule.re, text);
    if (!m || shouldSkipExfilHit(rule.id, text)) {
      continue;
    }
    score += rule.weight;
    hits.push({
      id: rule.id,
      layer: "semantic",
      severity: rule.severity,
      category: rule.category,
      message: rule.message,
      evidence: m[0].trim().slice(0, 80),
      confidence: rule.weight,
    });
  }

  if (score < THRESHOLD()) return [];
  return hits.sort((a, b) => b.confidence - a.confidence);
}

export { LOCAL_SEMANTIC_RULES, LOCAL_SEMANTIC_RULE_PROBES } from "./local-semantic-rules.js";
