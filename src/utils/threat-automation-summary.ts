import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countProcessedFingerprints } from '../ai/auto-corpus-writer.js';
import {
  getThreatResearchConfig,
  getThreatResearchQueueStatus,
  threatResearchAutoEnabled,
} from '../ai/threat-research-pipeline.js';
import { ensureThreatLabLlmReady, threatLabMode } from '../ai/threat-lab.js';
import { resolveTenantSwarmDir } from '../tenant/swarm-tenant-paths.js';
import { readRecentLearningEvents, type LearningEvent } from './learning-events.js';
import { parseAutoResearchLogTail } from './parse-auto-research-log.js';
import { getSchedulerStatus } from './threat-discovery-scheduler.js';
import { getThreatDiscoveryJobStatus } from './threat-discovery-runner.js';
import type { ThreatLabCandidateRecord, AutoCorpusManifestEntry } from './swarm-artifacts.js';

type ThreatLabManifest = {
  timestamp?: string;
  count?: number;
  mode?: string;
  llmModel?: string;
  llmUsed?: boolean;
  candidates?: ThreatLabCandidateRecord[];
};

type AutoCorpusManifest = {
  timestamp?: string;
  count?: number;
  entries?: AutoCorpusManifestEntry[];
};

function readTenantJson<T>(tenantId: string, fileName: string): T | null {
  const path = join(resolveTenantSwarmDir(tenantId), fileName);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function countBy(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item] = (out[item] || 0) + 1;
  }
  return out;
}

function aggregateCandidates(candidates: ThreatLabCandidateRecord[]) {
  const statuses = candidates.map((c) => c.reviewStatus || 'pending');
  return {
    total: candidates.length,
    pending: statuses.filter((s) => s === 'pending').length,
    byReviewStatus: countBy(statuses),
  };
}

function aggregateCorpus(entries: AutoCorpusManifestEntry[]) {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const last24h = entries.filter((entry) => Date.parse(entry.timestamp) >= dayAgo).length;
  return {
    total: entries.length,
    last24h,
    recent: [...entries]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 5),
  };
}

function parseThreatLabWritten(logTail: string): number | null {
  const match = logTail.match(/wrote\s+(\d+)\s+authentic/i);
  return match ? Number(match[1]) : null;
}

function aggregateLearning(events: LearningEvent[]) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const inLast24h = events.filter((event) => Date.parse(event.timestamp) >= cutoff);
  return {
    recent: events.slice(0, 15),
    counts24h: countBy(inLast24h.map((event) => event.type)),
  };
}

export interface ThreatAutomationSummary {
  timestamp: string;
  scheduler: ReturnType<typeof getSchedulerStatus>;
  features: {
    autoResearchEnabled: boolean;
    threatLabMode: 'reactive' | 'proactive';
    autoResearchConfig: ReturnType<typeof getThreatResearchConfig>;
  };
  llm: { ok: boolean; reason?: string; model?: string };
  pipeline: ReturnType<typeof getThreatResearchQueueStatus> & { ephemeral: true };
  processedFingerprints: number;
  jobs: {
    autoResearch: ReturnType<typeof getThreatDiscoveryJobStatus> & {
      parsed: ReturnType<typeof parseAutoResearchLogTail>;
    };
    threatLab: ReturnType<typeof getThreatDiscoveryJobStatus> & {
      parsed: { wroteAuthentic: number | null };
    };
  };
  autoCorpus: ReturnType<typeof aggregateCorpus>;
  threatLab: ReturnType<typeof aggregateCandidates>;
  learning: ReturnType<typeof aggregateLearning>;
  promotion: {
    enabled: boolean;
    totalPromoted: number;
    dailyQuota: { used: number; max: number };
    lastPromotionAt: string | null;
  };
}

export async function buildThreatAutomationSummary(tenantId: string): Promise<ThreatAutomationSummary> {
  const scheduler = getSchedulerStatus(tenantId);
  const autoResearchJob = getThreatDiscoveryJobStatus(tenantId, 'auto-research');
  const threatLabJob = getThreatDiscoveryJobStatus(tenantId, 'threat-lab');
  const autoCorpusManifest = readTenantJson<AutoCorpusManifest>(tenantId, 'auto-corpus-manifest.json');
  const threatLabManifest = readTenantJson<ThreatLabManifest>(tenantId, 'threat-lab-candidates.json');
  const events = readRecentLearningEvents(tenantId, 200);
  const llmReady = await ensureThreatLabLlmReady();

  let promotion = {
    enabled: false,
    totalPromoted: 0,
    dailyQuota: { used: 0, max: 5 },
    lastPromotionAt: null as string | null,
  };
  try {
    const { getPromotionStats } = await import('../ai/auto-corpus-promoter.js');
    const stats = await getPromotionStats();
    promotion = {
      enabled: stats.enabled,
      totalPromoted: stats.totalPromoted,
      dailyQuota: stats.dailyQuota,
      lastPromotionAt: stats.lastPromotionAt,
    };
  } catch {
    promotion.enabled = process.env.GUARDIAN_AUTO_CORPUS_PROMOTE === 'true';
  }

  const autoEntries = autoCorpusManifest?.entries || [];
  const candidates = threatLabManifest?.candidates || [];

  return {
    timestamp: new Date().toISOString(),
    scheduler,
    features: {
      autoResearchEnabled: threatResearchAutoEnabled(),
      threatLabMode: threatLabMode(),
      autoResearchConfig: getThreatResearchConfig(),
    },
    llm: {
      ok: llmReady.ok,
      reason: llmReady.reason,
      model: process.env.GUARDIAN_LLM_MODEL || process.env.OLLAMA_MODEL || undefined,
    },
    pipeline: { ...getThreatResearchQueueStatus(), ephemeral: true },
    processedFingerprints: countProcessedFingerprints(),
    jobs: {
      autoResearch: {
        ...autoResearchJob,
        parsed: parseAutoResearchLogTail(autoResearchJob.logTail),
      },
      threatLab: {
        ...threatLabJob,
        parsed: { wroteAuthentic: parseThreatLabWritten(threatLabJob.logTail) },
      },
    },
    autoCorpus: aggregateCorpus(autoEntries),
    threatLab: aggregateCandidates(candidates),
    learning: aggregateLearning(events),
    promotion,
  };
}
