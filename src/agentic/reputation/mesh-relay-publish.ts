/**
 * B1 — Publish reputation dimensions via MTX mesh-relay-client (plan-compliant path).
 */
import { createHash } from 'crypto';
import { MeshRelayClient } from '../threat-mesh/mesh-relay-client.js';
import type { ReputationEntry } from './reputation-network.js';
import { Logger } from '../../utils/logger.js';

export async function publishReputationViaMeshRelay(
  serverName: string,
  entry: ReputationEntry,
  packageName?: string,
): Promise<{ published: boolean; error?: string; via: 'mesh' | 'none' }> {
  const relayUrl = process.env.GUARDIAN_THREAT_MESH_RELAY_URL?.trim()
    ?? process.env.GUARDIAN_REPUTATION_RELAY_URL?.trim();
  if (!relayUrl) {
    return { published: false, error: 'relay_not_configured', via: 'none' };
  }

  const payload = JSON.stringify({
    serverName,
    packageName: packageName ?? '',
    dimensions: entry.dimensions,
    consensusScore: entry.consensusScore,
    level: entry.level,
  });
  const signatureHash = createHash('sha256').update(payload).digest('hex');

  const client = new MeshRelayClient({
    relayUrl,
    apiKey: process.env.GUARDIAN_THREAT_MESH_RELAY_API_KEY,
    tenantId: process.env.GUARDIAN_TENANT_ID,
  });

  const result = await client.publish([{
    signatureHash,
    mtxJson: JSON.stringify({
      type: 'reputation_network',
      serverName,
      packageName,
      dimensions: entry.dimensions,
      consensusScore: entry.consensusScore,
      level: entry.level,
      raterCount: entry.raterCount,
    }),
    category: 'reputation_network',
    severity: entry.level === 'bronze' ? 'medium' : 'low',
    verified: entry.raterCount >= 2,
    reportCount: entry.raterCount,
  }]);

  if (!result.ok) {
    Logger.debug(`[ReputationNetwork] Mesh relay publish failed: ${result.error}`);
    return { published: false, error: result.error, via: 'mesh' };
  }
  return { published: true, via: 'mesh' };
}
