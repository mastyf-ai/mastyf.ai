/**
 * B2 — Pull anonymized ecosystem telemetry from Guardian Cloud / observatory relay.
 */
import { Logger } from '../../utils/logger.js';
import type { ObservatorySnapshot } from './ecosystem-observatory.js';

export interface CloudObservatoryPayload {
  adoptionScore?: number;
  threatHeatIndex?: number;
  avgBlockRate?: number;
  serverCount?: number;
  topThreatClasses?: Array<{ cls: string; count: number }>;
  generatedAt?: string;
  metrics?: Array<{ metricType: string; value: number; dimension?: Record<string, unknown> }>;
}

export async function pullCloudObservatorySnapshot(): Promise<CloudObservatoryPayload | null> {
  if (process.env.GUARDIAN_OBSERVATORY_STUB === 'true') {
    return {
      avgBlockRate: 0.92,
      serverCount: 42,
      threatHeatIndex: 35,
      adoptionScore: 78,
      topThreatClasses: [{ cls: 'prompt_injection', count: 120 }],
      generatedAt: new Date().toISOString(),
    };
  }

  const relayUrl = process.env.GUARDIAN_OBSERVATORY_RELAY_URL?.trim()
    ?? process.env.GUARDIAN_CLOUD_URL?.trim();
  if (!relayUrl) return null;

  const base = relayUrl.replace(/\/$/, '');
  const url = `${base}/api/v1/observatory/snapshot`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(process.env.GUARDIAN_OBSERVATORY_RELAY_API_KEY
          ? { Authorization: `Bearer ${process.env.GUARDIAN_OBSERVATORY_RELAY_API_KEY}` }
          : {}),
      },
      signal: AbortSignal.timeout(Number(process.env.GUARDIAN_OBSERVATORY_RELAY_TIMEOUT_MS ?? 10_000)),
    });
    if (!res.ok) {
      Logger.debug(`[ObservatoryCloud] relay ${res.status} from ${url}`);
      return null;
    }
    return await res.json() as CloudObservatoryPayload;
  } catch (err: unknown) {
    Logger.debug(`[ObservatoryCloud] pull failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Merge cloud snapshot fields into local observatory metrics (B2 network effects). */
export function cloudPayloadToLocalMetrics(payload: CloudObservatoryPayload): Array<{
  metricType: string;
  value: number;
  dimension?: Record<string, unknown>;
}> {
  const out: Array<{ metricType: string; value: number; dimension?: Record<string, unknown> }> = [];
  if (payload.avgBlockRate != null) {
    out.push({ metricType: 'block_rate', value: payload.avgBlockRate, dimension: { source: 'cloud' } });
  }
  if (payload.serverCount != null) {
    out.push({ metricType: 'server_count', value: payload.serverCount, dimension: { source: 'cloud' } });
  }
  if (payload.threatHeatIndex != null) {
    out.push({ metricType: 'threat_heat', value: payload.threatHeatIndex, dimension: { source: 'cloud' } });
  }
  if (payload.adoptionScore != null) {
    out.push({ metricType: 'adoption_score', value: payload.adoptionScore, dimension: { source: 'cloud' } });
  }
  for (const tc of payload.topThreatClasses ?? []) {
    out.push({ metricType: 'threat_class', value: tc.count, dimension: { class: tc.cls, source: 'cloud' } });
  }
  for (const m of payload.metrics ?? []) {
    out.push({ metricType: m.metricType, value: m.value, dimension: { ...m.dimension, source: 'cloud' } });
  }
  return out;
}

export function mergeCloudIntoSnapshot(
  local: ObservatorySnapshot,
  cloud: CloudObservatoryPayload,
): ObservatorySnapshot {
  const cloudHeat = cloud.threatHeatIndex ?? local.threatHeatIndex;
  const cloudServers = cloud.serverCount ?? local.serverCount;
  const cloudBlock = cloud.avgBlockRate ?? local.avgBlockRate;
  return {
    ...local,
    adoptionScore: Math.max(local.adoptionScore, cloud.adoptionScore ?? 0),
    threatHeatIndex: Math.max(local.threatHeatIndex, cloudHeat),
    avgBlockRate: cloudBlock > 0 ? (local.avgBlockRate + cloudBlock) / 2 : local.avgBlockRate,
    serverCount: Math.max(local.serverCount, cloudServers),
    topThreatClasses: mergeThreatClasses(local.topThreatClasses, cloud.topThreatClasses ?? []),
    generatedAt: new Date().toISOString(),
  };
}

function mergeThreatClasses(
  local: Array<{ cls: string; count: number }>,
  cloud: Array<{ cls: string; count: number }>,
): Array<{ cls: string; count: number }> {
  const map = new Map<string, number>();
  for (const t of [...local, ...cloud]) {
    map.set(t.cls, (map.get(t.cls) ?? 0) + t.count);
  }
  return [...map.entries()].map(([cls, count]) => ({ cls, count })).sort((a, b) => b.count - a.count).slice(0, 10);
}
