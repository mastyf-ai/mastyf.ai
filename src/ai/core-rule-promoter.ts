/**
 * Promote Threat Lab discoveries into @mastyf_ai/core runtime learned-rules overlay.
 */
import {
  appendLearnedRule,
  validateLearnedRule,
  computeLearnedRuleFingerprint,
  listLearnedRules,
  reloadLearnedRules,
  type LearnedRuleDef,
  type LearnedRuleTarget,
} from '@mastyf_ai/core';
import type { ThreatLabDiscovery } from './threat-lab.js';
import { isDangerousUnblockPattern } from './learning-quorum.js';
import { queuePendingAttackSuggestion } from './instant-attack-learning.js';
import { snapshotAuditArguments } from '../utils/audit-args-snapshot.js';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export type CoreRulePromoteProvenance = {
  source: string;
  inputFingerprint: string;
  confidence: number;
};

export type CoreRulePromoteResult = {
  ok: boolean;
  status: 'promoted' | 'pending' | 'rejected' | 'skipped';
  reason?: string;
  ruleId?: string;
};

const METADATA_CATEGORIES = new Set([
  'prompt-injection',
  'identity-override',
  'goal-replacement',
  'goal-poisoning',
  'system-override',
  'cross-tool-chaining',
  'privilege-escalation',
  'stealth',
]);

function learnedRulesPromoteEnabled(): boolean {
  return process.env.MASTYF_AI_LEARNED_RULES_PROMOTE === 'true';
}

export function learnedRulesMinConfidence(): number {
  const n = parseFloat(process.env.MASTYF_AI_LEARNED_RULES_MIN_CONFIDENCE || '0.90');
  return Number.isFinite(n) && n > 0 ? n : 0.90;
}

function learnedRulesMaxPerDay(): number {
  const n = parseInt(process.env.MASTYF_AI_LEARNED_RULES_MAX_PER_DAY || '10', 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function promotionStatePath(): string {
  const base = process.env.MASTYF_AI_THREAT_RESEARCH_STATE_PATH || join(homedir(), '.mastyf-ai');
  return join(base, 'learned-rules-promotions.json');
}

type PromotionState = {
  date: string;
  count: number;
  entries: Array<{ fingerprint: string; ruleId: string; at: string }>;
};

function loadPromotionState(): PromotionState {
  const path = promotionStatePath();
  const today = new Date().toISOString().slice(0, 10);
  if (!existsSync(path)) return { date: today, count: 0, entries: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as PromotionState;
    if (raw.date !== today) return { date: today, count: 0, entries: [] };
    return raw;
  } catch {
    return { date: today, count: 0, entries: [] };
  }
}

function savePromotionState(state: PromotionState): void {
  const path = promotionStatePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function dailyPromotionQuotaOk(): boolean {
  return loadPromotionState().count < learnedRulesMaxPerDay();
}

function recordPromotion(fingerprint: string, ruleId: string): void {
  const state = loadPromotionState();
  state.entries.push({ fingerprint, ruleId, at: new Date().toISOString() });
  state.count = state.entries.length;
  savePromotionState(state);
}

function flattenStringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStringLeaves(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      flattenStringLeaves(v, out);
    }
  }
  return out;
}

function extractPattern(discovery: ThreatLabDiscovery): string | null {
  const fromPatterns = discovery.policyRule.patterns?.find((p) => p.trim());
  if (fromPatterns) return fromPatterns;
  for (const ap of discovery.policyRule.argPatterns || []) {
    const p = ap.patterns?.find((x) => x.trim());
    if (p) return p;
  }
  return null;
}

export function classifyLearnedRuleTarget(
  discovery: ThreatLabDiscovery,
  source: string,
): LearnedRuleTarget {
  const args = discovery.corpusCandidate.arguments ?? {};
  const hasStringArgs = flattenStringLeaves(args).length > 0;
  const pattern = extractPattern(discovery);

  if (
    source.includes('semantic')
    && METADATA_CATEGORIES.has(discovery.corpusCandidate.category)
    && !hasStringArgs
  ) {
    return 'local-semantic';
  }

  if (pattern && hasStringArgs) return 'argument';

  if (METADATA_CATEGORIES.has(discovery.corpusCandidate.category) && !hasStringArgs) {
    return 'local-semantic';
  }

  return 'argument';
}

function buildProbe(discovery: ThreatLabDiscovery, target: LearnedRuleTarget): string {
  if (target === 'argument') {
    const rawArgs = discovery.corpusCandidate.arguments ?? {};
    const safeArgs = snapshotAuditArguments(
      rawArgs as Record<string, unknown>,
    ) as Record<string, unknown> | undefined;
    const leaves = flattenStringLeaves(safeArgs ?? rawArgs);
    const usable = leaves.filter(
      (s) => s.trim().length >= 8 && !/\[REDACTED\]/.test(s),
    );
    const probe =
      usable.find((s) => s.trim().length >= 8)
      || leaves.find((s) => s.trim().length >= 8 && !/\[REDACTED\]/.test(s))
      || discovery.hypothesis;
    return probe.slice(0, 400);
  }
  return (discovery.hypothesis || discovery.attackClass).slice(0, 200);
}

function mapSeverity(discovery: ThreatLabDiscovery): 'critical' | 'warning' {
  return discovery.confidence >= 0.85 ? 'critical' : 'warning';
}

function buildDraft(
  discovery: ThreatLabDiscovery,
  provenance: CoreRulePromoteProvenance,
): Omit<LearnedRuleDef, 'id'> | null {
  const regex = extractPattern(discovery);
  if (!regex) return null;
  if (isDangerousUnblockPattern(discovery.policyRule.name, regex)) return null;

  const target = classifyLearnedRuleTarget(discovery, provenance.source);
  const probe = buildProbe(discovery, target);

  return {
    target,
    regex,
    category: discovery.corpusCandidate.category || 'prompt-injection',
    severity: mapSeverity(discovery),
    weight: Math.min(Math.max(discovery.confidence, 0.55), 0.95),
    message: `Learned: ${discovery.hypothesis}`.slice(0, 200),
    probe,
    provenance: {
      attackClass: discovery.attackClass,
      hypothesis: discovery.hypothesis,
      confidence: provenance.confidence,
      fingerprint: provenance.inputFingerprint,
      source: provenance.source,
      promotedAt: new Date().toISOString(),
    },
  };
}

function queuePendingLearnedRule(
  discovery: ThreatLabDiscovery,
  draft: Omit<LearnedRuleDef, 'id'>,
  provenance: CoreRulePromoteProvenance,
): boolean {
  return queuePendingAttackSuggestion(
    {
      rule: {
        name: `learned-core-${draft.target}-${computeLearnedRuleFingerprint(draft.target, draft.regex)}`,
        description: draft.message,
        action: 'block',
        patterns: [draft.regex],
      },
      confidence: provenance.confidence,
      reason: `Learned core rule pending review: ${discovery.hypothesis}`,
      source: 'attack',
    },
    { source: 'learned-core-rule', tenantId: undefined },
  );
}

/** Promote a validated Threat Lab discovery into the core learned-rules overlay. */
export function promoteDiscoveryToCoreRules(
  discovery: ThreatLabDiscovery,
  provenance: CoreRulePromoteProvenance,
): CoreRulePromoteResult {
  if (!learnedRulesPromoteEnabled()) {
    return { ok: false, status: 'skipped', reason: 'MASTYF_AI_LEARNED_RULES_PROMOTE not enabled' };
  }

  if (process.env.MASTYF_AI_LEARNED_RULES_ENABLED !== 'true') {
    return { ok: false, status: 'skipped', reason: 'MASTYF_AI_LEARNED_RULES_ENABLED not true' };
  }

  const draft = buildDraft(discovery, provenance);
  if (!draft) {
    StructuredLogger.info({
      event: 'learned_rule_rejected',
      fingerprint: provenance.inputFingerprint,
      reason: 'no safe pattern extractable',
    });
    return { ok: false, status: 'rejected', reason: 'no safe pattern extractable' };
  }

  const fp = computeLearnedRuleFingerprint(draft.target, draft.regex);
  if (listLearnedRules().some((r) => computeLearnedRuleFingerprint(r.target, r.regex) === fp)) {
    return { ok: false, status: 'skipped', reason: 'duplicate fingerprint' };
  }

  const validation = validateLearnedRule(draft);
  if (!validation.ok) {
    StructuredLogger.info({
      event: 'learned_rule_rejected',
      fingerprint: provenance.inputFingerprint,
      target: draft.target,
      reason: validation.errors.join('; '),
    });
    return { ok: false, status: 'rejected', reason: validation.errors.join('; ') };
  }

  if (provenance.confidence < learnedRulesMinConfidence()) {
    queuePendingLearnedRule(discovery, draft, provenance);
    StructuredLogger.info({
      event: 'learned_rule_pending',
      fingerprint: provenance.inputFingerprint,
      confidence: provenance.confidence,
      target: draft.target,
    });
    return { ok: true, status: 'pending', reason: 'below min confidence — queued for review' };
  }

  if (!dailyPromotionQuotaOk()) {
    queuePendingLearnedRule(discovery, draft, provenance);
    return { ok: true, status: 'pending', reason: 'daily promotion quota exceeded' };
  }

  const appended = appendLearnedRule(draft);
  if (!appended.ok) {
    return { ok: false, status: 'rejected', reason: appended.reason };
  }

  reloadLearnedRules();
  recordPromotion(fp, appended.rule.id);

  StructuredLogger.info({
    event: 'learned_rule_promoted',
    fingerprint: provenance.inputFingerprint,
    ruleId: appended.rule.id,
    target: draft.target,
    confidence: provenance.confidence,
  });
  Logger.info(
    `[core-rule-promoter] promoted ${appended.rule.id} (${draft.target}, conf=${provenance.confidence})`,
  );

  return { ok: true, status: 'promoted', ruleId: appended.rule.id };
}
