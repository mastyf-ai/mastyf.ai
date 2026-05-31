/**
 * CLI: guardian policy provenance verify|export
 */
import { writeFileSync } from 'fs';
import { ConfigProvenanceChain } from '../agentic/provenance/config-provenance-chain.js';
import type { ConfigProvenanceEvent } from '../agentic/provenance/config-provenance-chain.js';
import { writeSignedProvenanceTarball } from '../agentic/provenance/provenance-export.js';
import { createDatabase } from '../database/create-database.js';
import { IndustryStandardStore } from '../database/industry-standard-store.js';

function mapEvents(store: IndustryStandardStore, tenantId: string): ConfigProvenanceEvent[] {
  return store.listProvenanceEvents(tenantId).reverse().map(e => ({
    eventId: e.eventId,
    actor: e.actor,
    eventType: e.eventType as ConfigProvenanceEvent['eventType'],
    resourcePath: e.resourcePath,
    diff: e.diff,
    prevHash: e.prevHash,
    entryHash: e.entryHash,
    signature: e.signature,
    approvalId: e.approvalId,
    tenantId,
    createdAt: e.createdAt,
  }));
}

export async function runProvenanceVerify(tenantId = 'default'): Promise<{
  valid: boolean;
  eventCount: number;
  merkleRoot: string;
  reason?: string;
}> {
  const db = await createDatabase(process.env.MCP_GUARDIAN_DB_PATH);
  const store = new IndustryStandardStore(db);
  const mapped = mapEvents(store, tenantId);
  const chain = new ConfigProvenanceChain(store, tenantId);
  const result = chain.verify(mapped);
  return { valid: result.valid, eventCount: result.eventCount, merkleRoot: result.merkleRoot, reason: result.reason };
}

export async function runProvenanceExport(
  tenantId = 'default',
  opts?: { format?: 'json' | 'signed' | 'tarball'; output?: string },
): Promise<unknown> {
  const db = await createDatabase(process.env.MCP_GUARDIAN_DB_PATH);
  const store = new IndustryStandardStore(db);
  const mapped = mapEvents(store, tenantId);
  const chain = new ConfigProvenanceChain(store, tenantId);
  const format = opts?.format ?? 'json';
  const merkleRoot = chain.verify(mapped).merkleRoot;

  if (format === 'tarball') {
    const out = opts?.output ?? `provenance-${merkleRoot.slice(0, 8)}.tar.gz`;
    const result = writeSignedProvenanceTarball(mapped, merkleRoot, out);
    return { path: result.path, tarballBytes: result.tarballBytes, ...result.bundle };
  }

  if (format === 'signed') {
    const { exportSignedProvenanceBundle } = await import('../agentic/provenance/provenance-export.js');
    const bundle = exportSignedProvenanceBundle(mapped, merkleRoot);
    if (opts?.output) writeFileSync(opts.output, JSON.stringify(bundle, null, 2));
    return bundle;
  }

  const bundle = chain.exportBundle(mapped);
  if (opts?.output) writeFileSync(opts.output, JSON.stringify(bundle, null, 2));
  return bundle;
}
