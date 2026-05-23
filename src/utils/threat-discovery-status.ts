/**
 * Aggregated Threat Discovery hub status for dashboard API.
 */
import { getLicenseClient } from '../license/license-client.js';
import { isCiLicenseBypass } from '../license/feature-tiers.js';
import { isCiTokenCached } from '../license/ci-token.js';
import {
  ensureThreatLabLlmReady,
  threatLabEnabled,
  threatLabMode,
  threatLabMaxCandidates,
  threatLabSemanticEnabled,
} from '../ai/threat-lab.js';
import {
  getThreatResearchConfig,
  getThreatResearchQueueStatus,
  threatResearchAutoEnabled,
} from '../ai/threat-research-pipeline.js';
import { countProcessedFingerprints } from '../ai/auto-corpus-writer.js';
import {
  readThreatLabCandidates,
  readAutoCorpusManifest,
  type ThreatLabCandidateRecord,
  type AutoCorpusManifestEntry,
} from './swarm-artifacts.js';
import { getThreatDiscoveryJobStatus, type ThreatDiscoveryJobStatus } from './threat-discovery-runner.js';
import { isSwarmSessionActiveForTenant, swarmDataProvenance } from './swarm-session.js';

let llmCache: { at: number; ok: boolean; reason?: string; model?: string } | null = null;
const LLM_CACHE_MS = 30_000;

async function cachedLlmHealth(): Promise<{ ok: boolean; reason?: string; model?: string }> {
  const now = Date.now();
  if (llmCache && now - llmCache.at < LLM_CACHE_MS) {
    return { ok: llmCache.ok, reason: llmCache.reason, model: llmCache.model };
  }
  const ready = await ensureThreatLabLlmReady();
  llmCache = {
    at: now,
    ok: ready.ok,
    reason: ready.reason,
    model: process.env.GUARDIAN_LLM_MODEL || process.env.OLLAMA_MODEL || undefined,
  };
  return { ok: llmCache.ok, reason: llmCache.reason, model: llmCache.model };
}

function countBy<T extends string>(
  items: T[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item] = (out[item] || 0) + 1;
  }
  return out;
}

function aggregateThreatLab(candidates: ThreatLabCandidateRecord[]) {
  const reviewStatuses = candidates.map(
    (c) => c.reviewStatus || 'pending',
  ) as string[];
  const sources = candidates.map(
    (c) => c.provenance?.source || 'unknown',
  ) as string[];
  const confidences = candidates.map((c) => c.confidence);
  const avgConfidence =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;
  return {
    total: candidates.length,
    pending: reviewStatuses.filter((s) => s === 'pending').length,
    accepted: reviewStatuses.filter((s) => s === 'accepted').length,
    rejected: reviewStatuses.filter((s) => s === 'rejected').length,
    byReviewStatus: countBy(reviewStatuses),
    bySource: countBy(sources),
    byAttackClass: countBy(candidates.map((c) => c.attackClass)),
    avgConfidence,
    confidenceBuckets: [
      { bucket: '0.5–0.7', count: confidences.filter((c) => c >= 0.5 && c < 0.7).length },
      { bucket: '0.7–0.85', count: confidences.filter((c) => c >= 0.7 && c < 0.85).length },
      { bucket: '0.85+', count: confidences.filter((c) => c >= 0.85).length },
    ],
  };
}

function aggregateAutoCorpus(entries: AutoCorpusManifestEntry[]) {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const last24h = entries.filter(
    (e) => Date.parse(e.timestamp) >= dayAgo,
  ).length;
  const timeline = [...entries]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((e) => ({
      advId: e.advId,
      timestamp: e.timestamp,
      source: e.source,
      confidence: e.confidence,
    }));
  return {
    total: entries.length,
    last24h,
    bySource: countBy(entries.map((e) => e.source)),
    byAttackClass: countBy(entries.map((e) => e.attackClass)),
    timeline,
  };
}

export interface ThreatDiscoveryStatus {
  timestamp: string;
  license: { swarmFeature: boolean; bypass: boolean };
  features: {
    threatLabEnabled: boolean;
    threatLabMode: 'reactive' | 'proactive';
    threatLabMax: number;
    threatLabSemantic: boolean;
    autoResearchEnabled: boolean;
    autoResearchConfig: ReturnType<typeof getThreatResearchConfig>;
  };
  llm: { ok: boolean; reason?: string; model?: string };
  pipeline: ReturnType<typeof getThreatResearchQueueStatus>;
  processedFingerprints: number;
  threatLab: {
    manifest: ReturnType<typeof readThreatLabCandidates>;
    stats: ReturnType<typeof aggregateThreatLab>;
  };
  autoCorpus: {
    manifest: ReturnType<typeof readAutoCorpusManifest>;
    stats: ReturnType<typeof aggregateAutoCorpus>;
  };
  jobs: {
    threatLab: ThreatDiscoveryJobStatus;
    autoResearch: ThreatDiscoveryJobStatus;
  };
  provenance: ReturnType<typeof swarmDataProvenance>;
}

export async function buildThreatDiscoveryStatus(
  tenantId: string,
): Promise<ThreatDiscoveryStatus> {
  const llm = await cachedLlmHealth();
  const sessionActive = isSwarmSessionActiveForTenant(tenantId);
  const threatLabManifest = sessionActive ? readThreatLabCandidates(tenantId) : null;
  const autoManifest = sessionActive ? readAutoCorpusManifest(tenantId) : null;
  const candidates = threatLabManifest?.candidates || [];
  const entries = autoManifest?.entries || [];

  const hasSwarm =
    getLicenseClient().hasFeature('swarm')
    || isCiLicenseBypass()
    || isCiTokenCached();

  return {
    timestamp: new Date().toISOString(),
    license: {
      swarmFeature: hasSwarm,
      bypass: isCiLicenseBypass() || isCiTokenCached(),
    },
    features: {
      threatLabEnabled: threatLabEnabled(),
      threatLabMode: threatLabMode(),
      threatLabMax: threatLabMaxCandidates(),
      threatLabSemantic: threatLabSemanticEnabled(),
      autoResearchEnabled: threatResearchAutoEnabled(),
      autoResearchConfig: getThreatResearchConfig(),
    },
    llm,
    pipeline: getThreatResearchQueueStatus(),
    processedFingerprints: countProcessedFingerprints(),
    threatLab: {
      manifest: threatLabManifest,
      stats: aggregateThreatLab(candidates),
    },
    autoCorpus: {
      manifest: autoManifest,
      stats: aggregateAutoCorpus(entries),
    },
    jobs: {
      threatLab: getThreatDiscoveryJobStatus(tenantId, 'threat-lab'),
      autoResearch: getThreatDiscoveryJobStatus(tenantId, 'auto-research'),
    },
    provenance: swarmDataProvenance(tenantId),
  };
}

/** Test helper — clear LLM health cache. */
export function resetThreatDiscoveryStatusCacheForTests(): void {
  llmCache = null;
}
