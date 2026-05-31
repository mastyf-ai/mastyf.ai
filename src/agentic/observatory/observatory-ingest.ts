/**
 * B2 — Wire guardian-bench, fleet heartbeat, MTX catalog, and cloud relay into ecosystem observatory.
 */
import type { EcosystemObservatory } from './ecosystem-observatory.js';
import { Logger } from '../../utils/logger.js';
import {
  pullCloudObservatorySnapshot,
  cloudPayloadToLocalMetrics,
} from './observatory-cloud-relay.js';

export function ingestGuardianBenchIntoObservatory(
  observatory: EcosystemObservatory,
  submission: {
    blockRate: number;
    falsePositiveRate: number;
    serverCount: number;
    threatClasses?: Record<string, number>;
    guardianVersion?: string;
  },
): void {
  observatory.ingestBenchmarkSubmission(submission);
  if (submission.guardianVersion) {
    observatory.recordMetric('guardian_version', 1, { version: submission.guardianVersion });
  }
  Logger.debug('[ObservatoryIngest] Benchmark submission recorded');
}

export function ingestFleetHeartbeatIntoObservatory(
  observatory: EcosystemObservatory,
  heartbeat: {
    instanceCount?: number;
    serverCount?: number;
    blockRate?: number;
  },
): void {
  if (heartbeat.instanceCount != null) {
    observatory.recordMetric('fleet_instances', heartbeat.instanceCount);
  }
  if (heartbeat.serverCount != null) {
    observatory.recordMetric('server_count', heartbeat.serverCount);
  }
  if (heartbeat.blockRate != null) {
    observatory.recordMetric('block_rate', heartbeat.blockRate);
  }
}

export function ingestMtxCatalogIntoObservatory(
  observatory: EcosystemObservatory,
  signatures: Array<{ category: string; severity?: string }>,
): void {
  const byCategory = new Map<string, number>();
  for (const sig of signatures) {
    byCategory.set(sig.category, (byCategory.get(sig.category) ?? 0) + 1);
  }
  for (const [cls, count] of byCategory) {
    observatory.recordMetric('threat_class', count, { class: cls, source: 'mtx-catalog' });
  }
  observatory.recordMetric('mtx_signatures', signatures.length);
}

/** Pull and ingest live ecosystem telemetry from Guardian Cloud (B2). */
export async function ingestCloudObservatoryRelay(
  observatory: EcosystemObservatory,
): Promise<{ ingested: number; cloudAvailable: boolean }> {
  const cloud = await pullCloudObservatorySnapshot();
  if (!cloud) return { ingested: 0, cloudAvailable: false };
  const metrics = cloudPayloadToLocalMetrics(cloud);
  const ingested = observatory.ingestCloudMetrics(metrics);
  Logger.info(`[ObservatoryIngest] Cloud relay: ${ingested} metric(s) ingested`);
  return { ingested, cloudAvailable: true };
}
