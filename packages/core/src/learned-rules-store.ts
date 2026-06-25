import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LearnedRuleDef, LearnedRulesFile, LearnedRuleTarget } from "./learned-rules-types.js";
import {
  learnedRulesEnabled,
  learnedRulesMaxTotal,
  learnedRulesPath,
  learnedRulesReloadMs,
} from "./learned-rules-config.js";
import { validateLearnedRule } from "./validate-learned-rule.js";
import type { ValidateLearnedRuleOptions } from "./validate-learned-rule.js";

let cachedRules: LearnedRuleDef[] = [];
let reloadTimer: ReturnType<typeof setInterval> | null = null;
/** Test override for overlay path. */
let pathOverride: string | null = null;

function storePath(): string {
  return pathOverride ?? learnedRulesPath();
}

function emptyFile(): LearnedRulesFile {
  return { version: 1, updatedAt: new Date().toISOString(), rules: [] };
}

function readFile(): LearnedRulesFile {
  const path = storePath();
  if (!existsSync(path)) return emptyFile();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as LearnedRulesFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.rules)) return emptyFile();
    return parsed;
  } catch {
    return emptyFile();
  }
}

function writeFile(data: LearnedRulesFile): void {
  const path = storePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  data.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function nextRuleId(target: LearnedRuleTarget, existing: LearnedRuleDef[]): string {
  const prefix = target === "argument" ? "MCPG-A-LRN-" : "MCPG-LOC-LRN-";
  let max = 0;
  for (const r of existing) {
    if (!r.id.startsWith(prefix)) continue;
    const n = parseInt(r.id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function fingerprint(rule: Pick<LearnedRuleDef, "target" | "regex">): string {
  return createHash("sha256").update(`${rule.target}\0${rule.regex}`).digest("hex").slice(0, 16);
}

/** Load overlay rules from disk into memory (no-op when disabled). */
export function reloadLearnedRules(): LearnedRuleDef[] {
  if (!learnedRulesEnabled()) {
    cachedRules = [];
    return cachedRules;
  }
  cachedRules = readFile().rules;
  return cachedRules;
}

/** In-memory learned rules (after reload). */
export function listLearnedRules(target?: LearnedRuleTarget): LearnedRuleDef[] {
  if (!learnedRulesEnabled()) return [];
  if (cachedRules.length === 0 && learnedRulesEnabled()) {
    reloadLearnedRules();
  }
  return target ? cachedRules.filter((r) => r.target === target) : [...cachedRules];
}

export function getLearnedRulesStats(): { enabled: boolean; total: number; argument: number; localSemantic: number } {
  const rules = listLearnedRules();
  return {
    enabled: learnedRulesEnabled(),
    total: rules.length,
    argument: rules.filter((r) => r.target === "argument").length,
    localSemantic: rules.filter((r) => r.target === "local-semantic").length,
  };
}

export type AppendLearnedRuleResult =
  | { ok: true; rule: LearnedRuleDef }
  | { ok: false; reason: string };

/** Append a validated rule to the overlay file. */
export function appendLearnedRule(
  draft: Omit<LearnedRuleDef, "id"> & { id?: string },
  validateOpts?: ValidateLearnedRuleOptions,
): AppendLearnedRuleResult {
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

  const rule: LearnedRuleDef = {
    ...draft,
    id: draft.id ?? nextRuleId(draft.target, file.rules),
  };

  file.rules.push(rule);
  writeFile(file);
  cachedRules = file.rules;
  return { ok: true, rule };
}

/** Start periodic overlay reload; returns stop function. */
export function startLearnedRulesReloadTimer(): () => void {
  stopLearnedRulesReloadTimer();
  reloadLearnedRules();
  const ms = learnedRulesReloadMs();
  if (ms <= 0) return () => {};
  reloadTimer = setInterval(() => reloadLearnedRules(), ms);
  return stopLearnedRulesReloadTimer;
}

export function stopLearnedRulesReloadTimer(): void {
  if (reloadTimer) {
    clearInterval(reloadTimer);
    reloadTimer = null;
  }
}

/** @internal */
export function resetLearnedRulesForTests(): void {
  stopLearnedRulesReloadTimer();
  cachedRules = [];
  pathOverride = null;
}

/** @internal */
export function setLearnedRulesPathForTests(path: string | null): void {
  pathOverride = path;
  cachedRules = [];
}

/** @internal */
export function writeLearnedRulesFileForTests(rules: LearnedRuleDef[]): void {
  writeFile({ version: 1, updatedAt: new Date().toISOString(), rules });
  cachedRules = rules;
}
