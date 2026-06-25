import { describe, expect, it, beforeEach, afterEach } from "vitest";
// @ts-expect-error safe-regex has no types
import safe from "safe-regex";
import { getArgumentScannerPatterns } from "../src/argument-scanner.js";
import { getArgumentPromptInjectionPatterns, reloadArgumentInjectionRules } from "../src/argument-prompt-injection.js";
import { testPattern } from "../src/safe-pattern-match.js";
import {
  appendLearnedRule,
  resetLearnedRulesForTests,
  setLearnedRulesPathForTests,
  reloadLearnedRules,
} from "../src/learned-rules-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Intentionally match regex-bomb payloads — not applied to unbounded user-supplied regex. */
const REDOS_PAYLOAD_SOURCES = new Set([
  String.raw`(?:a+){10,}`,
  String.raw`(?:a+a+)+b`,
  String.raw`(?:\([^)]{0,20}\)\*){3,}`,
]);

function collectPatterns(): RegExp[] {
  return [...getArgumentScannerPatterns(), ...getArgumentPromptInjectionPatterns()];
}

function isStaticallySafe(pattern: RegExp): boolean {
  if (REDOS_PAYLOAD_SOURCES.has(pattern.source)) return true;
  return safe(new RegExp(pattern.source, pattern.flags));
}

function completesQuicklyOnCappedInput(pattern: RegExp): boolean {
  const blob = "a".repeat(8192);
  const t0 = performance.now();
  testPattern(pattern, blob);
  return performance.now() - t0 < 50;
}

describe("argument regex safety", () => {
  const patterns = collectPatterns();

  it("collects scanner + PI patterns", () => {
    expect(patterns.length).toBeGreaterThan(100);
  });

  it.each(patterns.map((p, i) => [i, p] as const))(
    "pattern #%i is safe-regex clean, allowlisted, or fast on capped input",
    (_idx, pattern) => {
      const ok = isStaticallySafe(pattern) || completesQuicklyOnCappedInput(pattern);
      expect(ok, `slow or unsafe pattern: /${pattern.source}/${pattern.flags}`).toBe(true);
    },
  );
});

describe("learned overlay regex safety", () => {
  let tempDir: string;

  beforeEach(() => {
    resetLearnedRulesForTests();
    reloadArgumentInjectionRules();
    tempDir = mkdtempSync(join(tmpdir(), "lrn-safe-"));
    setLearnedRulesPathForTests(join(tempDir, "learned-rules.json"));
    process.env.MASTYF_AI_LEARNED_RULES_ENABLED = "true";
  });

  afterEach(() => {
    process.env.MASTYF_AI_LEARNED_RULES_ENABLED = "false";
    resetLearnedRulesForTests();
    reloadArgumentInjectionRules();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("includes learned argument patterns in safety audit", () => {
    const marker = `safe_audit_${Date.now()}`;
    appendLearnedRule({
      target: "argument",
      regex: marker,
      category: "prompt-injection",
      severity: "critical",
      weight: 0.85,
      message: "learned safety test",
      probe: marker,
      provenance: {
        attackClass: "test",
        hypothesis: "test",
        confidence: 0.95,
        fingerprint: "fp-safe",
        source: "test",
        promotedAt: new Date().toISOString(),
      },
    }, { skipFalsePositiveCheck: true });
    reloadLearnedRules();

    const learned = getArgumentPromptInjectionPatterns().filter((p) => p.source.includes("safe_audit"));
    expect(learned.length).toBeGreaterThan(0);
    for (const pattern of learned) {
      const ok = safe(new RegExp(pattern.source, pattern.flags)) || completesQuicklyOnCappedInput(pattern);
      expect(ok).toBe(true);
    }
  });
});
