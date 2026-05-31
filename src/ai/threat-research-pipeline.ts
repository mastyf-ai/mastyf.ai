/**
 * Automated Threat Research → corpus pipeline orchestrator.
 */
import { Logger } from '../utils/logger.js';
import { getLicenseClient } from '../license/license-client.js';
import { isCiLicenseBypass } from '../license/feature-tiers.js';
import { isCiTokenCached } from '../license/ci-token.js';
import {
  discoverFromBypass,
  discoverFromCorpusSeed,
  discoverFromSemanticFlag,
  discoverFromThreatIntel,
  ensureThreatLabLlmReady,
  loadCorpusSamples,
  validateThreatLabDiscovery,
  type BypassContext,
  type ThreatLabDiscovery,
  type CorpusCandidate,
  type ThreatLabCandidateProvenance,
  type ThreatLabSource,
} from './threat-lab.js';
import { normalizeDiscoveryClassification, categoryFromBlockRule } from './threat-taxonomy.js';
import {
  candidateFingerprint,
  isFingerprintProcessed,
  markThreatResearchProcessed,
  writeAutoCorpusFixture,
  countProcessedFingerprints,
  type AutoCorpusSource,
} from './auto-corpus-writer.js';

export { countProcessedFingerprints } from './auto-corpus-writer.js';
import type { StoredSemanticAudit } from './semantic-audit-store.js';
import type { ThreatIntelEntry } from './threat-intel.js';
import { promoteToCorpus, type CorpusPromotionProvenance } from './auto-corpus-promoter.js';
import { loadAttackLearningState } from './instant-attack-learning.js';

export type ThreatResearchEventType = AutoCorpusSource;

export interface ThreatResearchEvent {
  type: ThreatResearchEventType;
  fingerprint: string;
  confidence?: number;
  bypass?: BypassContext;
  semanticRecord?: StoredSemanticAudit;
  threatEntry?: ThreatIntelEntry;
  corpusSeed?: CorpusCandidate & { relPath?: string };
  blockRule?: string;
  toolName?: string;
}

export interface ThreatResearchResult {
  ok: boolean;
  advId?: string;
  relPath?: string;
  reason?: string;
  fingerprint?: string;
}

export type AutoCorpusWriteInput = {
  discovery: ThreatLabDiscovery;
  source: AutoCorpusSource;
  inputFingerprint: string;
  llmUsed?: boolean;
};

/** Map Threat Lab provenance sources to auto-corpus writer sources. */
export function threatLabSourceToAutoCorpusSource(source: ThreatLabSource): AutoCorpusSource {
  switch (source) {
    case 'semantic-tp':
      return 'semantic_flag';
    case 'threat-intel':
      return 'threat_intel';
    case 'corpus-proactive':
      return 'corpus_proactive';
    case 'bypass':
    default:
      return 'bypass';
  }
}

function replayRequiredForCorpusWrite(override?: boolean): boolean {
  if (override !== undefined) return override;
  return process.env.GUARDIAN_AUTOPILOT_CORPUS_GATE === 'true' || requireReplay();
}

/** Shared normalize → validate → write → promote path for runtime and Threat Lab batch. */
async function persistValidatedDiscoveryToAutoCorpus(
  input: AutoCorpusWriteInput,
  opts?: { requireReplayBlock?: boolean; recordRateLimit?: boolean },
): Promise<ThreatResearchResult> {
  const { discovery, source, inputFingerprint } = input;
  const fp = inputFingerprint || candidateFingerprint(discovery);

  if (isFingerprintProcessed(fp)) {
    return { ok: false, reason: 'duplicate fingerprint', fingerprint: fp };
  }

  let normalized: ThreatLabDiscovery;
  try {
    normalized = normalizeDiscoveryClassification(discovery);
  } catch {
    return { ok: false, reason: 'classification normalization failed', fingerprint: fp };
  }

  const validation = validateThreatLabDiscovery(normalized, {
    requireReplayBlock: replayRequiredForCorpusWrite(opts?.requireReplayBlock),
  });
  if (!validation.ok) {
    return { ok: false, reason: validation.errors.join('; '), fingerprint: fp };
  }

  const written = writeAutoCorpusFixture(normalized, {
    source,
    inputFingerprint: fp,
    llmUsed: input.llmUsed ?? true,
    attackClass: normalized.attackClass,
    hypothesis: normalized.hypothesis,
    confidence: normalized.confidence,
  });
  if (!written) {
    return { ok: false, reason: 'fixture write skipped (duplicate)', fingerprint: fp };
  }

  markThreatResearchProcessed(fp);
  if (opts?.recordRateLimit) {
    recordHourlyWrite();
  }

  Logger.info(
    `[threat-research] auto-wrote ${written.advId} (${normalized.attackClass}, source=${source})`,
  );

  try {
    const { appendLearningEvent } = await import('../utils/learning-events.js');
    appendLearningEvent({
      type: 'threat_research_write',
      detail: `${written.advId} ${normalized.attackClass}`,
      fingerprint: fp,
      confidence: normalized.confidence,
    });
  } catch {
    /* non-fatal */
  }

  if (process.env.GUARDIAN_AUTO_CORPUS_PROMOTE === 'true') {
    try {
      const provenance: CorpusPromotionProvenance = {
        source,
        inputFingerprint: fp,
        attackClass: normalized.attackClass,
        hypothesis: normalized.hypothesis,
        confidence: normalized.confidence,
        llmUsed: input.llmUsed ?? true,
        advId: written.advId,
      };
      const promoted = await promoteToCorpus(normalized, provenance);
      if (promoted.ok) {
        Logger.info(
          `[threat-research] auto-promoted ${written.advId} → corpus/attacks/${promoted.category}/${promoted.relPath?.split('/').pop()}`,
        );
      }
    } catch (err) {
      Logger.debug(
        `[threat-research] auto-promotion failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    ok: true,
    advId: written.advId,
    relPath: written.relPath,
    fingerprint: written.fingerprint,
  };
}

/**
 * Write a Threat Lab–validated discovery via the auto-corpus path (no second LLM call, no rate limit).
 */
export async function writeValidatedDiscoveryToAutoCorpus(
  discovery: ThreatLabDiscovery,
  provenance: ThreatLabCandidateProvenance,
  opts?: { requireReplayBlock?: boolean },
): Promise<ThreatResearchResult> {
  const fp = provenance.inputFingerprint || candidateFingerprint(discovery);
  return persistValidatedDiscoveryToAutoCorpus(
    {
      discovery,
      source: threatLabSourceToAutoCorpusSource(provenance.source),
      inputFingerprint: fp,
      llmUsed: provenance.llmUsed,
    },
    { requireReplayBlock: opts?.requireReplayBlock, recordRateLimit: false },
  );
}

const queue: ThreatResearchEvent[] = [];
let drainTimer: ReturnType<typeof setTimeout> | null = null;
const hourTimestamps: number[] = [];

function debounceMs(): number {
  const n = parseInt(process.env.GUARDIAN_THREAT_RESEARCH_DEBOUNCE_MS || '5000', 10);
  return Number.isFinite(n) && n >= 0 ? n : 5000;
}

function maxPerHour(): number {
  const n = parseInt(process.env.GUARDIAN_THREAT_RESEARCH_MAX_PER_HOUR || '20', 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function minConfidence(): number {
  if (process.env.GUARDIAN_THREAT_RESEARCH_MIN_CONFIDENCE !== undefined) {
    const n = parseFloat(process.env.GUARDIAN_THREAT_RESEARCH_MIN_CONFIDENCE);
    if (Number.isFinite(n)) return n;
  }
  if (process.env.GUARDIAN_CI_BYPASS_LICENSE === 'true') return 0.75;
  const n = parseFloat(process.env.GUARDIAN_THREAT_RESEARCH_MIN_CONFIDENCE || '0.85');
  return Number.isFinite(n) ? n : 0.85;
}

function requireReplay(): boolean {
  return process.env.GUARDIAN_THREAT_RESEARCH_REQUIRE_REPLAY === 'true';
}

export function threatResearchAutoEnabled(): boolean {
  if (process.env.GUARDIAN_THREAT_RESEARCH_AUTO !== 'true') return false;
  if (process.env.SWARM_THREAT_RESEARCH_AUTO === 'true') return true;
  if (isCiLicenseBypass() || isCiTokenCached()) return true;
  return getLicenseClient().hasFeature('swarm');
}

/** When true, Threat Lab writes adv fixtures via the auto-corpus path (not legacy direct writes). */
export function autoThreatResearchOwnsAdvWrites(): boolean {
  return (
    process.env.GUARDIAN_THREAT_RESEARCH_AUTO === 'true'
    && process.env.SWARM_THREAT_RESEARCH_AUTO === 'true'
  );
}

function semanticEnabled(): boolean {
  return process.env.GUARDIAN_THREAT_RESEARCH_SEMANTIC !== 'false';
}

function blocksEnabled(): boolean {
  return process.env.GUARDIAN_THREAT_RESEARCH_BLOCKS !== 'false';
}

function threatIntelEnabled(): boolean {
  return process.env.GUARDIAN_THREAT_RESEARCH_THREAT_INTEL !== 'false';
}

function pruneHourly(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (hourTimestamps.length && hourTimestamps[0] < cutoff) {
    hourTimestamps.shift();
  }
}

function rateLimitOk(): boolean {
  pruneHourly();
  return hourTimestamps.length < maxPerHour();
}

function recordHourlyWrite(): void {
  hourTimestamps.push(Date.now());
}

export interface ThreatResearchQueueStatus {
  queued: number;
  writesThisHour: number;
  maxPerHour: number;
  debounceMs: number;
  enabled: boolean;
  sources: {
    semantic: boolean;
    blocks: boolean;
    threatIntel: boolean;
  };
}

export interface ThreatResearchConfig {
  autoEnabled: boolean;
  swarmAutoEnabled: boolean;
  ownsAdvWrites: boolean;
  minConfidence: number;
  semanticMinConfidence: number;
  requireReplay: boolean;
  maxPerHour: number;
  debounceMs: number;
  batchMax: number;
  proactiveEnabled: boolean;
  sources: ThreatResearchQueueStatus['sources'];
}

export function getThreatResearchConfig(): ThreatResearchConfig {
  const semanticMin = parseFloat(
    process.env.GUARDIAN_THREAT_RESEARCH_SEMANTIC_MIN_CONFIDENCE || '0.85',
  );
  const batchMax = parseInt(process.env.SWARM_THREAT_RESEARCH_MAX || '10', 10);
  return {
    autoEnabled: process.env.GUARDIAN_THREAT_RESEARCH_AUTO === 'true',
    swarmAutoEnabled: process.env.SWARM_THREAT_RESEARCH_AUTO === 'true',
    ownsAdvWrites: autoThreatResearchOwnsAdvWrites(),
    minConfidence: minConfidence(),
    semanticMinConfidence: Number.isFinite(semanticMin) ? semanticMin : 0.85,
    requireReplay: requireReplay(),
    maxPerHour: maxPerHour(),
    debounceMs: debounceMs(),
    batchMax: Number.isFinite(batchMax) && batchMax > 0 ? batchMax : 10,
    proactiveEnabled: process.env.SWARM_THREAT_RESEARCH_PROACTIVE !== 'false',
    sources: {
      semantic: semanticEnabled(),
      blocks: blocksEnabled(),
      threatIntel: threatIntelEnabled(),
    },
  };
}

export function getThreatResearchQueueStatus(): ThreatResearchQueueStatus {
  pruneHourly();
  const config = getThreatResearchConfig();
  return {
    queued: queue.length,
    writesThisHour: hourTimestamps.length,
    maxPerHour: config.maxPerHour,
    debounceMs: config.debounceMs,
    enabled: threatResearchAutoEnabled(),
    sources: config.sources,
  };
}

export function enqueueThreatResearch(event: ThreatResearchEvent): void {
  if (!threatResearchAutoEnabled()) return;
  if (event.confidence !== undefined && event.confidence < minConfidence()) return;
  if (isFingerprintProcessed(event.fingerprint)) return;

  queue.push(event);
  if (drainTimer) return;
  drainTimer = setTimeout(() => {
    drainTimer = null;
    void drainThreatResearchQueue();
  }, debounceMs());
}

async function drainThreatResearchQueue(): Promise<void> {
  while (queue.length > 0) {
    const event = queue.shift();
    if (!event) break;
    try {
      await processThreatResearchEvent(event);
    } catch (err) {
      Logger.debug(
        `[threat-research] event failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

async function discoverForEvent(
  event: ThreatResearchEvent,
  llm: Awaited<ReturnType<typeof ensureThreatLabLlmReady>>['llm'],
  seq: number,
): Promise<ThreatLabDiscovery | null> {
  switch (event.type) {
    case 'semantic_flag':
      if (!semanticEnabled() || !event.semanticRecord) return null;
      return discoverFromSemanticFlag(event.semanticRecord, { llm, seq });
    case 'block_repeat':
      if (!blocksEnabled() || !event.bypass) return null;
      return discoverFromBypass(event.bypass, { llm, seq });
    case 'threat_intel':
      if (!threatIntelEnabled() || !event.threatEntry) return null;
      return discoverFromThreatIntel(event.threatEntry, { llm, seq });
    case 'bypass':
      if (!event.bypass) return null;
      return discoverFromBypass(event.bypass, { llm, seq });
    case 'corpus_proactive':
      if (!event.corpusSeed) return null;
      return discoverFromCorpusSeed(event.corpusSeed, { llm, seq });
    default:
      return null;
  }
}

export async function processThreatResearchEvent(
  event: ThreatResearchEvent,
): Promise<ThreatResearchResult> {
  if (!threatResearchAutoEnabled()) {
    return { ok: false, reason: 'auto threat research disabled' };
  }
  if (!rateLimitOk()) {
    return { ok: false, reason: 'hourly rate limit exceeded' };
  }
  if (isFingerprintProcessed(event.fingerprint)) {
    return { ok: false, reason: 'duplicate fingerprint' };
  }

  const ready = await ensureThreatLabLlmReady();
  if (!ready.ok) {
    return { ok: false, reason: ready.reason || 'LLM unavailable' };
  }

  const discovery = await discoverForEvent(event, ready.llm, 1);
  if (!discovery) {
    return { ok: false, reason: 'LLM discovery returned null' };
  }
  if (discovery.confidence < minConfidence()) {
    return { ok: false, reason: 'below min confidence' };
  }

  return persistValidatedDiscoveryToAutoCorpus(
    {
      discovery,
      source: event.type,
      inputFingerprint: event.fingerprint,
      llmUsed: true,
    },
    { recordRateLimit: true },
  );
}

export async function processThreatResearchBatch(
  events: ThreatResearchEvent[],
): Promise<ThreatResearchResult[]> {
  const results: ThreatResearchResult[] = [];
  for (const event of events) {
    if (!rateLimitOk()) {
      results.push({ ok: false, reason: 'hourly rate limit exceeded' });
      break;
    }
    results.push(await processThreatResearchEvent(event));
  }
  return results;
}

/** Test helper — reset in-memory queue and hourly rate limit state. */
export function resetThreatResearchQueueForTests(): void {
  queue.length = 0;
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
  hourTimestamps.length = 0;
}

export interface BlockRepeatWindowBlock {
  blockReason: string;
  argsFingerprint: string;
  argSnippets?: string[];
  arguments?: Record<string, unknown>;
}

export function buildBlockRepeatEvent(
  blockRule: string,
  toolName: string,
  blockReason: string,
  argsFingerprint: string,
  opts?: {
    arguments?: Record<string, unknown>;
    argSnippets?: string[];
    windowBlocks?: BlockRepeatWindowBlock[];
  },
): ThreatResearchEvent {
  const snippets = [
    ...(opts?.argSnippets || []),
    ...(opts?.windowBlocks || []).flatMap((b) => b.argSnippets || []),
  ].slice(0, 8);
  const latestArgs =
    opts?.arguments
    || [...(opts?.windowBlocks || [])].reverse().find((b) => b.arguments)?.arguments;
  const reasons = [
    blockReason,
    ...(opts?.windowBlocks || []).map((b) => b.blockReason).filter(Boolean),
  ].slice(0, 5);
  const payloadParts = [...new Set([...snippets, ...reasons.map((r) => r.slice(0, 200))])];
  return {
    type: 'block_repeat',
    fingerprint: `block:${blockRule}:${toolName}:${argsFingerprint}`,
    bypass: {
      fingerprint: `block-${blockRule}-${toolName}-${argsFingerprint}`,
      toolName,
      category: categoryFromBlockRule(blockRule),
      block_reason: blockReason,
      ruleHint: blockRule,
      payload: payloadParts.join(' | ').slice(0, 1200),
      arguments: latestArgs,
      args: latestArgs,
    },
  };
}

export function buildSemanticFlagEvent(record: StoredSemanticAudit): ThreatResearchEvent {
  return {
    type: 'semantic_flag',
    fingerprint: `semantic:${record.id}`,
    confidence: record.semanticAudit?.confidence,
    semanticRecord: record,
  };
}

export function buildThreatIntelEvent(entry: ThreatIntelEntry): ThreatResearchEvent {
  return {
    type: 'threat_intel',
    fingerprint: `threat-intel:${entry.id}`,
    threatEntry: entry,
  };
}

export function buildBypassEvent(bypass: BypassContext): ThreatResearchEvent {
  const fp =
    bypass.fingerprint ||
    `bypass:${bypass.toolName || bypass.tool}:${JSON.stringify(bypass.arguments || bypass.args || {})}`;
  return { type: 'bypass', fingerprint: fp, bypass };
}

export function buildCorpusProactiveEvents(limit: number): ThreatResearchEvent[] {
  return loadCorpusSamples({ limit }).map((seed) => ({
    type: 'corpus_proactive' as const,
    fingerprint: `corpus-seed:${seed.relPath}`,
    corpusSeed: seed,
    confidence: 1,
  }));
}

/** Live block-repeat signals from instant attack-learning state (batch job + runtime queue). */
export function buildBlockRepeatEventsFromAttackState(
  limit: number,
  tenantId?: string,
): ThreatResearchEvent[] {
  if (!blocksEnabled()) return [];
  const state = loadAttackLearningState(tenantId);
  const events: ThreatResearchEvent[] = [];
  const seen = new Set<string>();
  for (const block of [...(state.recentBlocks ?? [])].reverse()) {
    if (events.length >= limit) break;
    const fp = `block:${block.blockRule}:${block.toolName}:${block.argsFingerprint}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    events.push(
      buildBlockRepeatEvent(
        block.blockRule,
        block.toolName,
        block.blockReason,
        block.argsFingerprint,
        {
          arguments: block.arguments,
          argSnippets: block.argSnippets,
        },
      ),
    );
  }
  return events;
}

/** Prefer signals not yet in the processed ledger (avoids wasted LLM calls on reruns). */
export function filterUnprocessedEvents(events: ThreatResearchEvent[]): ThreatResearchEvent[] {
  return events.filter((ev) => !isFingerprintProcessed(ev.fingerprint));
}
