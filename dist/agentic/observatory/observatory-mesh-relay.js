/**
 * B2 — Publish/pull anonymized observatory snapshots via threat mesh (peer telemetry path).
 */
import { createHash } from 'crypto';
import { MeshRelayClient } from '../threat-mesh/mesh-relay-client.js';
import { cloudPayloadToLocalMetrics } from './observatory-cloud-relay.js';
import { Logger } from '../../utils/logger.js';
function relayClient() {
    const relayUrl = process.env.MASTYF_AI_THREAT_MESH_RELAY_URL?.trim()
        ?? process.env.MASTYF_AI_OBSERVATORY_RELAY_URL?.trim();
    if (!relayUrl)
        return null;
    return new MeshRelayClient({
        relayUrl,
        apiKey: process.env.MASTYF_AI_THREAT_MESH_RELAY_API_KEY,
        tenantId: process.env.MASTYF_AI_TENANT_ID,
    });
}
export async function publishObservatorySnapshotToMesh(observatory) {
    const client = relayClient();
    if (!client)
        return { ok: false, error: 'relay_not_configured' };
    const snap = observatory.snapshot();
    const payload = {
        adoptionScore: snap.adoptionScore,
        threatHeatIndex: snap.threatHeatIndex,
        avgBlockRate: snap.avgBlockRate,
        serverCount: snap.serverCount,
        topThreatClasses: snap.topThreatClasses,
        generatedAt: snap.generatedAt,
    };
    const body = JSON.stringify({ type: 'observatory_ecosystem', ...payload });
    const signatureHash = createHash('sha256').update(body).digest('hex');
    const result = await client.publish([{
            signatureHash,
            mtxJson: body,
            category: 'observatory_ecosystem',
            severity: snap.threatHeatIndex >= 75 ? 'high' : 'low',
            verified: true,
            reportCount: snap.serverCount,
        }]);
    if (!result.ok)
        Logger.debug(`[ObservatoryMesh] publish failed: ${result.error}`);
    return { ok: result.ok, error: result.error };
}
export async function pullObservatorySnapshotsFromMesh(observatory, limit = 100) {
    const client = relayClient();
    if (!client)
        return 0;
    const catalog = await client.pullCatalog(limit);
    if (!catalog.ok)
        return 0;
    let ingested = 0;
    for (const sig of catalog.signatures) {
        if (sig.category !== 'observatory_ecosystem')
            continue;
        const raw = sig.metadata?.mtxJson;
        if (typeof raw !== 'string')
            continue;
        try {
            const parsed = JSON.parse(raw);
            const metrics = cloudPayloadToLocalMetrics(parsed);
            ingested += observatory.ingestCloudMetrics(metrics.map(m => ({ ...m, dimension: { ...m.dimension, source: 'mesh-peer' } })));
        }
        catch {
            // skip malformed
        }
    }
    if (ingested > 0)
        Logger.info(`[ObservatoryMesh] Ingested ${ingested} peer metric(s) from mesh`);
    return ingested;
}
//# sourceMappingURL=observatory-mesh-relay.js.map