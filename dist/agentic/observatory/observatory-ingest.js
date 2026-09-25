import { Logger } from '../../utils/logger.js';
import { pullCloudObservatorySnapshot, cloudPayloadToLocalMetrics, } from './observatory-cloud-relay.js';
export function ingestMastyfAiBenchIntoObservatory(observatory, submission) {
    observatory.ingestBenchmarkSubmission(submission);
    if (submission.mastyfAiVersion) {
        observatory.recordMetric('mastyf-ai_version', 1, { version: submission.mastyfAiVersion });
    }
    Logger.debug('[ObservatoryIngest] Benchmark submission recorded');
}
export function ingestFleetHeartbeatIntoObservatory(observatory, heartbeat) {
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
export function ingestMtxCatalogIntoObservatory(observatory, signatures) {
    const byCategory = new Map();
    for (const sig of signatures) {
        byCategory.set(sig.category, (byCategory.get(sig.category) ?? 0) + 1);
    }
    for (const [cls, count] of byCategory) {
        observatory.recordMetric('threat_class', count, { class: cls, source: 'mtx-catalog' });
    }
    observatory.recordMetric('mtx_signatures', signatures.length);
}
/** Pull and ingest live ecosystem telemetry from Mastyf AI Cloud (B2). */
export async function ingestCloudObservatoryRelay(observatory) {
    const cloud = await pullCloudObservatorySnapshot();
    if (!cloud)
        return { ingested: 0, cloudAvailable: false };
    const metrics = cloudPayloadToLocalMetrics(cloud);
    const ingested = observatory.ingestCloudMetrics(metrics);
    Logger.info(`[ObservatoryIngest] Cloud relay: ${ingested} metric(s) ingested`);
    return { ingested, cloudAvailable: true };
}
//# sourceMappingURL=observatory-ingest.js.map