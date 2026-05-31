/**
 * B3 — Publish/pull federated model deltas via threat mesh relay.
 */
import { createHash } from 'crypto';
import { MeshRelayClient } from '../threat-mesh/mesh-relay-client.js';
import type { FederatedModelDelta } from './federated-learning.js';
import { Logger } from '../../utils/logger.js';

export async function pullFederatedDeltasFromMesh(limit = 200): Promise<FederatedModelDelta[]> {
  const relayUrl = process.env.GUARDIAN_THREAT_MESH_RELAY_URL?.trim()
    ?? process.env.GUARDIAN_FEDERATED_RELAY_URL?.trim();
  if (!relayUrl) return [];

  const client = new MeshRelayClient({
    relayUrl,
    apiKey: process.env.GUARDIAN_THREAT_MESH_RELAY_API_KEY,
    tenantId: process.env.GUARDIAN_TENANT_ID,
  });

  const catalog = await client.pullCatalog(limit);
  if (!catalog.ok) {
    Logger.debug(`[FederatedMesh] pull failed: ${catalog.error}`);
    return [];
  }

  const deltas: FederatedModelDelta[] = [];
  for (const sig of catalog.signatures) {
    if (sig.category !== 'federated_learning') continue;
    const raw = sig.metadata?.mtxJson;
    if (typeof raw !== 'string') continue;
    try {
      const parsed = JSON.parse(raw) as Partial<FederatedModelDelta & { type?: string }>;
      if (parsed.type !== 'federated_learning' && !parsed.deltaId) continue;
      if (!parsed.deltaId || !parsed.signatureHash) continue;
      deltas.push({
        deltaId: parsed.deltaId,
        modelVersion: parsed.modelVersion ?? 'remote',
        signatureHash: parsed.signatureHash,
        sampleCount: parsed.sampleCount ?? sig.reportCount ?? 1,
        privacyBudgetEpsilon: parsed.privacyBudgetEpsilon ?? 1.0,
        createdAt: parsed.createdAt ?? sig.firstSeen,
      });
    } catch {
      // skip malformed mesh records
    }
  }
  return deltas;
}

export async function publishFederatedDeltaViaMesh(delta: FederatedModelDelta): Promise<{ ok: boolean; error?: string }> {
  const relayUrl = process.env.GUARDIAN_THREAT_MESH_RELAY_URL?.trim()
    ?? process.env.GUARDIAN_FEDERATED_RELAY_URL?.trim();
  if (!relayUrl) return { ok: false, error: 'relay_not_configured' };

  const payload = JSON.stringify(delta);
  const signatureHash = createHash('sha256').update(payload).digest('hex');
  const client = new MeshRelayClient({
    relayUrl,
    apiKey: process.env.GUARDIAN_THREAT_MESH_RELAY_API_KEY,
    tenantId: process.env.GUARDIAN_TENANT_ID,
  });

  const result = await client.publish([{
    signatureHash,
    mtxJson: JSON.stringify({ type: 'federated_learning', ...delta }),
    category: 'federated_learning',
    severity: 'low',
    verified: delta.sampleCount >= 3,
    reportCount: delta.sampleCount,
  }]);

  if (!result.ok) {
    Logger.debug(`[FederatedMesh] publish failed: ${result.error}`);
  }
  return { ok: result.ok, error: result.error };
}
