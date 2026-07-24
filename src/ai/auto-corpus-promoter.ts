/**
 * Auto-Corpus Promoter — bridges auto-discovered threats from adversarial-harness
 * into the corpus evaluation pipeline (corpus/attacks/).
 *
 * Unlike auto-corpus-writer.ts which only writes to adversarial-harness/fixtures/,
 * this module promotes validated discoveries to:
 *   1. corpus/attacks/<category>/<name>.json — for pnpm eval regression tests
 *   2. Updates corpus/manifest.yaml counts automatically
 *   3. Verifies the fixture is actually blocked by the current policy before promoting
 *
 * Safety gates (all configurable via env vars):
 *   - MASTYF_AI_AUTO_CORPUS_PROMOTE (default: false) — master switch
 *   - MASTYF_AI_AUTO_CORPUS_MIN_CONFIDENCE (default: 0.90)
 *   - MASTYF_AI_AUTO_CORPUS_MAX_PER_DAY (default: 5)
 *   - MASTYF_AI_AUTO_CORPUS_REQUIRE_PARITY (default: false)
 */
import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { load } from 'js-yaml';
import type { ThreatLabDiscovery } from './threat-lab.js';
import type { AutoCorpusSource } from './auto-corpus-writer.js';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';

// ── Types ────────────────────────────────────────────────────────────

export interface CorpusPromotionProvenance {
  source: AutoCorpusSource;
  inputFingerprint: string;
  attackClass: string;
  hypothesis: string;
  confidence: number;
  llmUsed: boolean;
  advId: string;
}

export interface CorpusPromotionResult {
  ok: boolean;
  relPath?: string;
  category?: string;
  reason?: string;
}

export interface CorpusPromotionManifest {
  timestamp: string;
  count: number;
  entries: Array<{
    relPath: string;
    category: string;
    advId: string;
    confidence: number;
    source: AutoCorpusSource;
    promotedAt: string;
  }>;
}

// ── Configuration ────────────────────────────────────────────────────

const CORPUS_ROOT = join(process.cwd(), 'corpus', 'attacks');
const MANIFEST_PATH = join(process.cwd(), 'corpus', 'manifest.yaml');
const PROMOTION_STATE_PATH = join(
  process.env.MASTYF_AI_THREAT_RESEARCH_STATE_PATH || join(homedir(), '.mastyf-ai'),
  'corpus-promotions.json',
);

function isPromotionEnabled(): boolean {
  return process.env.MASTYF_AI_AUTO_CORPUS_PROMOTE === 'true';
}

function minConfidence(): number {
  const n = parseFloat(process.env.MASTYF_AI_AUTO_CORPUS_MIN_CONFIDENCE || '0.90');
  return Number.isFinite(n) && n > 0 ? n : 0.90;
}

function maxPerDay(): number {
  const n = parseInt(process.env.MASTYF_AI_AUTO_CORPUS_MAX_PER_DAY || '5', 10);
  if (n === 0) return Infinity;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function requireParity(): boolean {
  return process.env.MASTYF_AI_AUTO_CORPUS_REQUIRE_PARITY === 'true';
}

function dailyPromotionQuotaOk(): boolean {
  const manifest = loadPromotionManifest();
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = manifest.entries.filter(
    (e) => e.promotedAt.slice(0, 10) === today,
  ).length;
  return todayCount < maxPerDay();
}

// ── Promotion Manifest ───────────────────────────────────────────────

function loadPromotionManifest(): CorpusPromotionManifest {
  if (!existsSync(PROMOTION_STATE_PATH)) {
    return { timestamp: new Date().toISOString(), count: 0, entries: [] };
  }
  try {
    return JSON.parse(readFileSync(PROMOTION_STATE_PATH, 'utf-8')) as CorpusPromotionManifest;
  } catch {
    return { timestamp: new Date().toISOString(), count: 0, entries: [] };
  }
}

function savePromotionManifest(manifest: CorpusPromotionManifest): void {
  const dir = dirname(PROMOTION_STATE_PATH);
  mkdirSync(dir, { recursive: true });
  manifest.count = manifest.entries.length;
  manifest.timestamp = new Date().toISOString();
  if (manifest.entries.length > 500) {
    manifest.entries = manifest.entries.slice(-500);
    manifest.count = manifest.entries.length;
  }
  writeFileSync(PROMOTION_STATE_PATH, JSON.stringify(manifest, null, 2));
}

function isAlreadyPromoted(advId: string): boolean {
  const manifest = loadPromotionManifest();
  return manifest.entries.some((e) => e.advId === advId);
}

// ── Category Mapping ─────────────────────────────────────────────────

const ATTACK_CLASS_TO_CORPUS_DIR: Record<string, string> = {
  'sql-injection': 'sql-nosql',
  'nosql-injection': 'sql-nosql',
  'boundary-evasion': 'boundary-evasion',
  'credential-exfil': 'credential-exfil',
  'shell-injection': 'shell-obfuscation',
  'shell-obfuscation': 'shell-obfuscation',
  'prompt-injection': 'prompt-injection',
  'context-injection': 'context-injection',
  'polyglot-injection': 'polyglot-injection',
  'ssrf': 'ssrf-url',
  'command-injection': 'command-injection',
  'xml-injection': 'sql-nosql',  // XML/XXE grouped with injection
  'ldap-injection': 'sql-nosql',  // LDAP grouped with injection
  'deserialization': 'deserialization',
  'redos': 'edge-cases',
  'dangerous-js': 'dangerous-js',
  'file-inclusion': 'file-inclusion',
  'log-injection': 'log-injection',
  'email-injection': 'http-smuggling',
  'http-smuggling': 'http-smuggling',
  'graphql-injection': 'graphql-injection',
  'cache-poisoning': 'edge-cases',
  'jwt-manipulation': 'jwt-manipulation',
  'crlf-injection': 'log-injection',
  'zip-slip': 'zip-slip',
  'type-juggling': 'edge-cases',
  'obfuscation-evasion': 'edge-cases',
  'cross-tool-chaining': 'cross-tool-chain',
};

function categoryFromAttackClass(attackClass: string): string {
  return ATTACK_CLASS_TO_CORPUS_DIR[attackClass] || 'edge-cases';
}

// ── Manifest Update ──────────────────────────────────────────────────

function incrementManifestCategory(category: string): void {
  if (!existsSync(MANIFEST_PATH)) {
    Logger.warn(`[auto-corpus-promoter] manifest.yaml not found at ${MANIFEST_PATH}`);
    return;
  }
  try {
    const raw = readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = load(raw) as {
      categories?: Record<string, { description?: string; expected?: string; count?: number }>;
      total?: number;
    };
    if (!manifest.categories) manifest.categories = {};
    if (!manifest.categories[category]) {
      manifest.categories[category] = {
        description: `Auto-promoted attacks: ${category}`,
        expected: 'block',
        count: 0,
      };
    }
    manifest.categories[category].count = (manifest.categories[category].count || 0) + 1;
    manifest.total = (manifest.total || 0) + 1;

    writeFileSync(MANIFEST_PATH, load(raw) ? raw : ''); // Preserve existing format
    // Re-write with updated counts using manual YAML editing to preserve comments
    const lines = raw.split('\n');
    let inCategory = false;
    let foundCategory = false;
    const out: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith(`${category}:`)) {
        inCategory = true;
        foundCategory = true;
        out.push(line);
        continue;
      }
      if (inCategory) {
        if (line.match(/^\s+count:\s*\d+$/)) {
          out.push(line.replace(/\d+/, String(manifest.categories[category].count)));
          inCategory = false;
          continue;
        }
        if (line.trim() === '' || line.match(/^\s{0,4}\w/)) {
          // Category doesn't have a count line — add one before next category
          out.push(`    count: ${manifest.categories[category].count}`);
          inCategory = false;
          out.push(line);
          continue;
        }
      }
      out.push(line);
    }

    // Update total line
    for (let i = 0; i < out.length; i++) {
      if (out[i].match(/^total:\s*\d+/)) {
        out[i] = `total: ${manifest.total}`;
      }
    }

    writeFileSync(MANIFEST_PATH, out.join('\n'));
  } catch (err) {
    Logger.warn(`[auto-corpus-promoter] Failed to update manifest: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Policy Verification ──────────────────────────────────────────────

async function verifyFixtureBlocked(
  toolName: string,
  args: Record<string, unknown>,
  expectedBlockRule?: string,
): Promise<{ blocked: boolean; rule?: string; reason?: string }> {
  try {
    const { PolicyEngine } = await import('../policy/policy-engine.js');
    const policyPath = process.env.MASTYF_AI_POLICY_PATH || join(process.cwd(), 'default-policy.yaml');
    if (!existsSync(policyPath)) {
      return { blocked: false, reason: 'policy file not found' };
    }
    const policyConfig = load(readFileSync(policyPath, 'utf-8')) as import('../policy/policy-types.js').PolicyConfig;
    const engine = new PolicyEngine(policyConfig);
    const decision = engine.evaluate({
      serverName: 'corpus-promoter',
      toolName,
      arguments: args,
      requestId: `promote-${Date.now()}`,
      requestTokens: JSON.stringify(args).length,
      timestamp: new Date().toISOString(),
    });
    return {
      blocked: decision.action === 'block',
      rule: decision.rule,
      reason: decision.reason,
    };
  } catch (err) {
    return { blocked: false, reason: `evaluation error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Main Promotion Function ──────────────────────────────────────────

export async function promoteToCorpus(
  discovery: ThreatLabDiscovery,
  provenance: CorpusPromotionProvenance,
): Promise<CorpusPromotionResult> {
  if (!isPromotionEnabled()) {
    return { ok: false, reason: 'auto corpus promotion disabled (set MASTYF_AI_AUTO_CORPUS_PROMOTE=true)' };
  }

  if (provenance.confidence < minConfidence()) {
    return { ok: false, reason: `confidence ${provenance.confidence.toFixed(2)} below minimum ${minConfidence()}` };
  }

  if (!dailyPromotionQuotaOk()) {
    return { ok: false, reason: `daily promotion quota exceeded (${maxPerDay()} per day)` };
  }

  if (isAlreadyPromoted(provenance.advId)) {
    return { ok: false, reason: `already promoted ${provenance.advId}` };
  }

  const category = categoryFromAttackClass(provenance.attackClass);
  const candidate = discovery.corpusCandidate;

  // Verify the fixture is actually blocked by current policy
  const verifyResult = await verifyFixtureBlocked(
    candidate.toolName,
    candidate.arguments ?? {},
    candidate.ruleHint,
  );

  if (!verifyResult.blocked) {
    Logger.warn(
      `[auto-corpus-promoter] Fixture ${provenance.advId} not blocked by current policy: ${verifyResult.reason || 'unknown'}`,
    );
    return {
      ok: false,
      reason: `fixture not blocked by current policy: ${verifyResult.reason || 'passed evaluation'}`,
    };
  }

  // Ensure category directory exists
  const categoryDir = join(CORPUS_ROOT, category);
  mkdirSync(categoryDir, { recursive: true });

  // Generate fixture filename
  let existingCount = 0;
  if (existsSync(categoryDir)) {
    existingCount = readdirSync(categoryDir).filter((f) => f.endsWith('.json')).length;
  }
  const seq = String(existingCount + 1).padStart(3, '0');
  const filename = `${category}-${seq}.json`;
  const relPath = `corpus/attacks/${category}/${filename}`;

  // Write corpus fixture
  const fixture = {
    toolName: candidate.toolName,
    arguments: candidate.arguments,
    expected: 'block' as const,
    category,
    ruleHint: candidate.ruleHint || provenance.attackClass,
    source: 'auto-promoted',
    autoResearch: {
      advId: provenance.advId,
      source: provenance.source,
      attackClass: provenance.attackClass,
      hypothesis: provenance.hypothesis,
      confidence: provenance.confidence,
      llmUsed: provenance.llmUsed,
      promotedAt: new Date().toISOString(),
      verifiedBlockedBy: verifyResult.rule || 'unknown',
    },
  };

  writeFileSync(join(categoryDir, filename), JSON.stringify(fixture, null, 2) + '\n');

  // Update corpus manifest
  incrementManifestCategory(category);

  // Record promotion
  const manifest = loadPromotionManifest();
  manifest.entries.push({
    relPath,
    category,
    advId: provenance.advId,
    confidence: provenance.confidence,
    source: provenance.source,
    promotedAt: new Date().toISOString(),
  });
  savePromotionManifest(manifest);

  StructuredLogger.info({
    event: 'corpus_auto_promoted',
    advId: provenance.advId,
    category,
    relPath,
    attackClass: provenance.attackClass,
    confidence: provenance.confidence,
    source: provenance.source,
  });

  Logger.info(
    `[auto-corpus-promoter] Promoted ${provenance.advId} → ${relPath} ` +
    `(category=${category}, confidence=${provenance.confidence.toFixed(2)})`,
  );

  return { ok: true, relPath, category };
}

/** Batch promote multiple discoveries. */
export async function promoteBatchToCorpus(
  discoveries: Array<{ discovery: ThreatLabDiscovery; provenance: CorpusPromotionProvenance }>,
): Promise<CorpusPromotionResult[]> {
  const results: CorpusPromotionResult[] = [];
  for (const item of discoveries) {
    if (!isPromotionEnabled()) {
      results.push({ ok: false, reason: 'disabled' });
      continue;
    }
    if (!dailyPromotionQuotaOk()) {
      results.push({ ok: false, reason: 'daily quota exceeded' });
      break;
    }
    results.push(await promoteToCorpus(item.discovery, item.provenance));
  }
  return results;
}

/** Get promotion statistics for dashboard. */
export function getPromotionStats(): {
  enabled: boolean;
  dailyQuota: { used: number; max: number };
  totalPromoted: number;
  byCategory: Record<string, number>;
  lastPromotionAt: string | null;
} {
  const manifest = loadPromotionManifest();
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = manifest.entries.filter((e) => e.promotedAt.slice(0, 10) === today).length;
  const byCategory: Record<string, number> = {};
  for (const entry of manifest.entries) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
  }

  return {
    enabled: isPromotionEnabled(),
    dailyQuota: { used: todayCount, max: maxPerDay() },
    totalPromoted: manifest.count,
    byCategory,
    lastPromotionAt: manifest.entries.length > 0
      ? manifest.entries[manifest.entries.length - 1].promotedAt
      : null,
  };
}

/** Exported for test use */
export function resetPromotionStateForTests(): void {
  if (existsSync(PROMOTION_STATE_PATH)) {
    writeFileSync(PROMOTION_STATE_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      count: 0,
      entries: [],
    }));
  }
}