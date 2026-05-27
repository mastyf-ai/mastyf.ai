export type ThreatAutomationSnapshot = {
  schedulerRunning: boolean;
  lastRunAt: string | null;
  totalRuns: number;
  lastRunOk: boolean;
  pipelineHealth: {
    queued: number;
    writesThisHour: number;
    maxPerHour: number;
    enabled: boolean;
    sources: Record<string, boolean>;
  };
  llm: {
    ok: boolean;
    model: string | null;
    reason: string | null;
  };
  autoCorpus: {
    total: number;
    last24h: number;
  };
  processedFingerprints: number;
  autoResearchLastLogTail: string | null;
};

export function mapAutomationStatus(
  schedulerData: Record<string, unknown>,
  threatDiscoveryData: Record<string, unknown>,
): ThreatAutomationSnapshot {
  const p = threatDiscoveryData.pipeline as Record<string, unknown> | undefined;
  const llm = threatDiscoveryData.llm as Record<string, unknown> | undefined;
  const autoCorpusStats = (threatDiscoveryData.autoCorpus as Record<string, unknown> | undefined)?.stats as
    | Record<string, unknown>
    | undefined;
  const jobs = threatDiscoveryData.jobs as Record<string, unknown> | undefined;
  const autoResearchJob = jobs?.autoResearch as Record<string, unknown> | undefined;
  return {
    schedulerRunning: (schedulerData.running as boolean) ?? false,
    lastRunAt: (schedulerData.lastRunAt as string) ?? null,
    totalRuns: (schedulerData.totalRuns as number) ?? 0,
    lastRunOk: (schedulerData.lastRunStatus as string) === 'success',
    pipelineHealth: {
      queued: (p?.queued as number) ?? 0,
      writesThisHour: (p?.writesThisHour as number) ?? 0,
      maxPerHour: (p?.maxPerHour as number) ?? 20,
      enabled: (p?.enabled as boolean) ?? false,
      sources: (p?.sources as Record<string, boolean>) ?? {},
    },
    llm: {
      ok: (llm?.ok as boolean) ?? false,
      model: typeof llm?.model === 'string' ? llm.model : null,
      reason: typeof llm?.reason === 'string' ? llm.reason : null,
    },
    autoCorpus: {
      total: (autoCorpusStats?.total as number) ?? 0,
      last24h: (autoCorpusStats?.last24h as number) ?? 0,
    },
    processedFingerprints: (threatDiscoveryData.processedFingerprints as number) ?? 0,
    autoResearchLastLogTail:
      typeof autoResearchJob?.logTail === 'string' ? autoResearchJob.logTail : null,
  };
}
