import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendLearnedRule,
  listLearnedRules,
  reloadLearnedRules,
  resetLearnedRulesForTests,
  setLearnedRulesPathForTests,
  getLearnedRulesStats,
} from "../src/learned-rules-store.js";
import { validateLearnedRule } from "../src/validate-learned-rule.js";
import { scanArgumentPromptInjection, reloadArgumentInjectionRules } from "../src/argument-prompt-injection.js";
import { runLocalSemanticFallback, resetLocalSemanticRulesForTests } from "../src/local-semantic-fallback.js";

const baseProvenance = {
  attackClass: "test-attack",
  hypothesis: "test hypothesis",
  confidence: 0.95,
  fingerprint: "fp-test-001",
  source: "test",
  promotedAt: new Date().toISOString(),
};

describe("learned rules overlay", () => {
  let tempDir: string;

  beforeEach(() => {
    resetLearnedRulesForTests();
    resetLocalSemanticRulesForTests();
    reloadArgumentInjectionRules();
    tempDir = mkdtempSync(join(tmpdir(), "learned-rules-"));
    setLearnedRulesPathForTests(join(tempDir, "learned-rules.json"));
    process.env.MASTYF_AI_LEARNED_RULES_ENABLED = "true";
  });

  afterEach(() => {
    process.env.MASTYF_AI_LEARNED_RULES_ENABLED = "false";
    resetLearnedRulesForTests();
    resetLocalSemanticRulesForTests();
    reloadArgumentInjectionRules();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects invalid regex", () => {
    const result = validateLearnedRule({
      target: "argument",
      regex: "(unclosed",
      probe: "test",
      message: "test",
      category: "prompt-injection",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects probe that does not match", () => {
    const result = validateLearnedRule({
      target: "argument",
      regex: "ignore\\s+all\\s+instructions",
      probe: "totally benign query",
      message: "instruction override",
      category: "prompt-injection",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("true positive"))).toBe(true);
  });

  it("appends argument rule and detects via scanner", () => {
    const appended = appendLearnedRule({
      target: "argument",
      regex: String.raw`threatlab_unique_marker_${Date.now()}`,
      category: "prompt-injection",
      severity: "critical",
      weight: 0.85,
      message: "Learned test rule",
      probe: `threatlab_unique_marker_${Date.now()}`,
      provenance: baseProvenance,
    }, { skipFalsePositiveCheck: true });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;

    reloadLearnedRules();
    const hits = scanArgumentPromptInjection(appended.rule.probe);
    expect(hits.some((h) => h.id === `MCPG-A-PI-${appended.rule.id}`)).toBe(true);
  });

  it("appends local-semantic rule and detects via fallback", () => {
    const marker = `loc_marker_${Date.now()}`;
    const appended = appendLearnedRule({
      target: "local-semantic",
      regex: marker,
      category: "prompt-injection",
      severity: "critical",
      weight: 0.85,
      message: "Learned local rule",
      probe: marker,
      provenance: baseProvenance,
    }, { skipFalsePositiveCheck: true });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;

    reloadLearnedRules();
    const hits = runLocalSemanticFallback({
      name: "probe",
      description: marker,
    });
    expect(hits.some((h) => h.id === appended.rule.id)).toBe(true);
  });

  it("deduplicates by fingerprint", () => {
    const draft = {
      target: "argument" as const,
      regex: "dedupe_test_pattern_xyz",
      category: "prompt-injection",
      severity: "critical" as const,
      weight: 0.85,
      message: "dedupe",
      probe: "dedupe_test_pattern_xyz",
      provenance: baseProvenance,
    };
    expect(appendLearnedRule(draft, { skipFalsePositiveCheck: true }).ok).toBe(true);
    expect(appendLearnedRule(draft, { skipFalsePositiveCheck: true }).ok).toBe(false);
  });

  it("lists rules from overlay file", () => {
    appendLearnedRule({
      target: "argument",
      regex: "list_test_abc",
      category: "prompt-injection",
      severity: "critical",
      weight: 0.85,
      message: "list test",
      probe: "list_test_abc",
      provenance: baseProvenance,
    }, { skipFalsePositiveCheck: true });
    reloadLearnedRules();
    expect(listLearnedRules("argument").length).toBe(1);
    expect(getLearnedRulesStats().total).toBe(1);
  });
});
