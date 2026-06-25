import { createHash } from "node:crypto";
import type { LearnedRuleDef, LearnedRuleTarget } from "./learned-rules-types.js";
import { testPattern } from "./safe-pattern-match.js";
import {
  BENIGN_ARGUMENT_SAMPLES,
  BENIGN_DESCRIPTION_SAMPLES,
} from "./learned-rules-benign-samples.js";

export type ValidateLearnedRuleOptions = {
  benignArgumentSamples?: string[];
  benignDescriptionSamples?: string[];
  /** Skip FP scan (tests only). */
  skipFalsePositiveCheck?: boolean;
};

export type ValidateLearnedRuleResult = {
  ok: boolean;
  errors: string[];
  fingerprint?: string;
};

const DANGEROUS_UNBLOCK = /\b(curl|wget|rm)\b/i;
const UNBOUNDED_DOT_QUANT = /\(\.\)[*+]|\.[*+]\)|\(\.\*\)[*+]/;

function ruleFingerprint(target: LearnedRuleTarget, regex: string): string {
  return createHash("sha256").update(`${target}\0${regex}`).digest("hex").slice(0, 16);
}

function isDangerousUnblockPattern(name: string, pattern: string): boolean {
  return DANGEROUS_UNBLOCK.test(`${name} ${pattern}`);
}

function completesQuicklyOnCappedInput(pattern: RegExp): boolean {
  const blob = "a".repeat(8192);
  const t0 = performance.now();
  testPattern(pattern, blob);
  return performance.now() - t0 < 50;
}

function matchesBenignSamples(
  pattern: RegExp,
  samples: string[],
): string | null {
  for (const sample of samples) {
    if (testPattern(pattern, sample)) {
      return sample.slice(0, 80);
    }
  }
  return null;
}

export function computeLearnedRuleFingerprint(
  target: LearnedRuleTarget,
  regex: string,
): string {
  return ruleFingerprint(target, regex);
}

/** Validate a learned rule before writing to the runtime overlay. */
export function validateLearnedRule(
  rule: Pick<LearnedRuleDef, "target" | "regex" | "probe" | "message" | "category">,
  opts: ValidateLearnedRuleOptions = {},
): ValidateLearnedRuleResult {
  const errors: string[] = [];
  const fp = ruleFingerprint(rule.target, rule.regex);

  if (!rule.regex.trim()) errors.push("regex required");
  if (!rule.probe.trim()) errors.push("probe required");
  if (!rule.message.trim()) errors.push("message required");
  if (!rule.category.trim()) errors.push("category required");

  if (isDangerousUnblockPattern(rule.message, rule.regex)) {
    errors.push("dangerous unblock pattern rejected");
  }

  if (UNBOUNDED_DOT_QUANT.test(rule.regex)) {
    errors.push("unbounded quantifier on dot rejected");
  }

  let compiled: RegExp;
  try {
    compiled = new RegExp(rule.regex, "ims");
  } catch {
    errors.push("invalid regex");
    return { ok: false, errors, fingerprint: fp };
  }

  if (!completesQuicklyOnCappedInput(compiled)) {
    errors.push("regex too slow on capped input (ReDoS risk)");
  }

  if (!testPattern(compiled, rule.probe)) {
    errors.push("probe must match regex (true positive check failed)");
  }

  if (!opts.skipFalsePositiveCheck) {
    const benignArgs = opts.benignArgumentSamples ?? [...BENIGN_ARGUMENT_SAMPLES];
    const benignDesc = opts.benignDescriptionSamples ?? [...BENIGN_DESCRIPTION_SAMPLES];

    if (rule.target === "argument") {
      const fpHit = matchesBenignSamples(compiled, benignArgs);
      if (fpHit) errors.push(`false positive on benign argument: "${fpHit}"`);
    } else {
      const fpHit = matchesBenignSamples(compiled, benignDesc);
      if (fpHit) errors.push(`false positive on benign description: "${fpHit}"`);
    }
  }

  return { ok: errors.length === 0, errors, fingerprint: fp };
}
