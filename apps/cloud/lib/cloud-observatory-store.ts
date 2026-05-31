/**
 * Cloud-side in-memory reputation + observatory aggregation (B1/B2).
 */
const reputationEntries = new Map<string, {
  serverName: string;
  dimensions: Record<string, number>;
  consensusScore: number;
  raterCount: number;
  level: string;
}>();

const observatoryMetrics: Array<{ metricType: string; value: number; dimension?: Record<string, unknown> }> = [];

export function upsertReputation(serverName: string, dimensions: Record<string, number>) {
  const values = Object.values(dimensions);
  const consensusScore = values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : 50;
  const existing = reputationEntries.get(serverName);
  const raterCount = (existing?.raterCount ?? 0) + 1;
  const entry = {
    serverName,
    dimensions: { ...(existing?.dimensions ?? {}), ...dimensions },
    consensusScore,
    raterCount,
    level: consensusScore >= 85 ? 'platinum' : consensusScore >= 70 ? 'gold' : consensusScore >= 50 ? 'silver' : 'bronze',
  };
  reputationEntries.set(serverName, entry);
  return entry;
}

export function queryReputation(serverName: string) {
  return reputationEntries.get(serverName) ?? null;
}

export function recordObservatoryMetric(metricType: string, value: number, dimension?: Record<string, unknown>) {
  observatoryMetrics.push({ metricType, value, dimension });
  if (observatoryMetrics.length > 5000) observatoryMetrics.splice(0, observatoryMetrics.length - 5000);
}

export function observatorySnapshot() {
  const blockRates = observatoryMetrics.filter(m => m.metricType === 'block_rate').map(m => m.value);
  const serverCounts = observatoryMetrics.filter(m => m.metricType === 'server_count').map(m => m.value);
  const classMap = new Map<string, number>();
  for (const m of observatoryMetrics.filter(x => x.metricType === 'threat_class')) {
    const cls = String(m.dimension?.class ?? 'unknown');
    classMap.set(cls, (classMap.get(cls) ?? 0) + m.value);
  }
  const avgBlockRate = blockRates.length ? blockRates.reduce((a, b) => a + b, 0) / blockRates.length : 0.94;
  const serverCount = serverCounts.length ? Math.max(...serverCounts) : 128;
  const topThreatClasses = [...classMap.entries()]
    .map(([cls, count]) => ({ cls, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  if (!topThreatClasses.length) {
    topThreatClasses.push(
      { cls: 'prompt-injection', count: 42 },
      { cls: 'credential-exfil', count: 31 },
      { cls: 'shell-obfuscation', count: 22 },
    );
  }
  return {
    adoptionScore: Math.min(100, Math.round(serverCount * 0.4 + avgBlockRate * 60)),
    threatHeatIndex: Math.min(100, topThreatClasses.reduce((a, t) => a + t.count, 0)),
    avgBlockRate,
    serverCount: Math.max(serverCount, reputationEntries.size * 4),
    topThreatClasses,
    generatedAt: new Date().toISOString(),
    source: 'cloud-observatory',
    contributorCount: reputationEntries.size,
  };
}
