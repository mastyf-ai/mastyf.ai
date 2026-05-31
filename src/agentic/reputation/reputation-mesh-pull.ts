/**
 * B1 — Pull signed reputation network entries from threat mesh catalog.
 */
import { MeshRelayClient } from '../threat-mesh/mesh-relay-client.js';
import type { ReputationNetwork } from './reputation-network.js';
import type { ReputationDimensions } from './reputation-network.js';
import { Logger } from '../../utils/logger.js';

export async function pullReputationEntriesFromMesh(
  network: ReputationNetwork,
  limit = 200,
): Promise<number> {
  const relayUrl = process.env.GUARDIAN_THREAT_MESH_RELAY_URL?.trim()
    ?? process.env.GUARDIAN_REPUTATION_RELAY_URL?.trim();
  if (!relayUrl) return 0;

  const client = new MeshRelayClient({
    relayUrl,
    apiKey: process.env.GUARDIAN_THREAT_MESH_RELAY_API_KEY,
    tenantId: process.env.GUARDIAN_TENANT_ID,
  });

  const catalog = await client.pullCatalog(limit);
  if (!catalog.ok) return 0;

  let ingested = 0;
  for (const sig of catalog.signatures) {
    if (sig.category !== 'reputation_network') continue;
    const raw = sig.metadata?.mtxJson;
    if (typeof raw !== 'string') continue;
    try {
      const parsed = JSON.parse(raw) as {
        type?: string;
        serverName?: string;
        packageName?: string;
        dimensions?: Partial<ReputationDimensions>;
        consensusScore?: number;
        raterCount?: number;
        attestationJws?: string;
      };
      if (!parsed.serverName) continue;
      if (parsed.attestationJws) {
        const res = network.ingestRemoteRating(parsed.attestationJws);
        if (res.ok) ingested++;
        continue;
      }
      network.rateServer({
        serverName: parsed.serverName,
        packageName: parsed.packageName,
        dimensions: parsed.dimensions ?? {},
        raterWeight: Math.max(1, parsed.raterCount ?? 1),
        raterId: `mesh:${sig.signatureHash.slice(0, 8)}`,
      });
      ingested++;
    } catch {
      // skip
    }
  }
  if (ingested > 0) Logger.info(`[ReputationMesh] Ingested ${ingested} mesh reputation entries`);
  return ingested;
}

/** Export quorum attestation bundle for a server (B1 decentralized sync). */
export function exportReputationAttestationBundle(
  network: ReputationNetwork,
  serverName: string,
  packageName?: string,
): { entry: ReturnType<ReputationNetwork['queryServerReputation']>; votes: unknown[] } {
  const entry = network.queryServerReputation(serverName, packageName);
  return {
    entry,
    votes: entry ? [{ attestationJws: entry.attestationJws, consensusScore: entry.consensusScore }] : [],
  };
}
