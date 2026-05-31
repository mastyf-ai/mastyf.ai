/**
 * C1 — Config Provenance & Verifiable Audit Chain (Merkle-linked events).
 */
import { createHash, randomUUID } from 'crypto';
import { appendSiemChainedEvent } from '../../utils/audit-hash-chain.js';
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import { buildMerkleRoot, leafHash, merkleProof, verifyMerkleProof, type MerkleProof } from './merkle-tree.js';

export type ConfigProvenanceEventType =
  | 'policy_apply'
  | 'policy_reload'
  | 'policy_approve'
  | 'policy_deny'
  | 'config_edit';

export interface ConfigProvenanceEvent {
  eventId: string;
  actor: string;
  eventType: ConfigProvenanceEventType;
  resourcePath: string;
  diff?: Record<string, unknown>;
  prevHash: string;
  entryHash: string;
  signature?: string;
  approvalId?: string;
  tenantId: string;
  createdAt: string;
}

export interface ProvenanceVerifyResult {
  valid: boolean;
  eventCount: number;
  brokenAt?: string;
  merkleRoot: string;
  reason?: string;
  merkleProof?: MerkleProof;
}

const CHECKPOINT_INTERVAL = 16;

const GENESIS = createHash('sha256').update('mcp-guardian-config-provenance-genesis').digest('hex');

function hashEntry(prevHash: string, payload: string): string {
  return createHash('sha256').update(`${prevHash}\n${payload}`).digest('hex');
}

export class ConfigProvenanceChain {
  private lastHash = GENESIS;
  private eventCount = 0;

  constructor(
    private readonly store?: IndustryStandardStore,
    private readonly tenantId = 'default',
  ) {
    const latest = store?.getLatestProvenanceHash?.(tenantId);
    if (latest) this.lastHash = latest;
  }

  append(params: {
    actor: string;
    eventType: ConfigProvenanceEventType;
    resourcePath: string;
    diff?: Record<string, unknown>;
    signature?: string;
    approvalId?: string;
  }): ConfigProvenanceEvent {
    const eventId = randomUUID();
    const createdAt = new Date().toISOString();
    const payload = JSON.stringify({
      eventId,
      actor: params.actor,
      eventType: params.eventType,
      resourcePath: params.resourcePath,
      diff: params.diff ?? null,
      approvalId: params.approvalId ?? null,
      createdAt,
    });
    const prevHash = this.lastHash;
    const entryHash = hashEntry(prevHash, payload);
    this.lastHash = entryHash;

    const event: ConfigProvenanceEvent = {
      eventId,
      actor: params.actor,
      eventType: params.eventType,
      resourcePath: params.resourcePath,
      diff: params.diff,
      prevHash,
      entryHash,
      signature: params.signature,
      approvalId: params.approvalId,
      tenantId: this.tenantId,
      createdAt,
    };

    this.store?.saveProvenanceEvent?.(event);
    this.eventCount++;
    if (this.eventCount % CHECKPOINT_INTERVAL === 0) {
      this.createMerkleCheckpoint();
    }
    appendSiemChainedEvent('config_provenance', {
      eventId,
      eventType: params.eventType,
      resourcePath: params.resourcePath,
      entryHash,
      actor: params.actor,
    });
    return event;
  }

  verify(events: ConfigProvenanceEvent[]): ProvenanceVerifyResult {
    let prev = GENESIS;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.prevHash !== prev) {
        return {
          valid: false,
          eventCount: events.length,
          brokenAt: e.eventId,
          merkleRoot: prev,
          reason: `Hash chain broken at event ${e.eventId}`,
        };
      }
      const payload = JSON.stringify({
        eventId: e.eventId,
        actor: e.actor,
        eventType: e.eventType,
        resourcePath: e.resourcePath,
        diff: e.diff ?? null,
        approvalId: e.approvalId ?? null,
        createdAt: e.createdAt,
      });
      const expected = hashEntry(prev, payload);
      if (expected !== e.entryHash) {
        return {
          valid: false,
          eventCount: events.length,
          brokenAt: e.eventId,
          merkleRoot: prev,
          reason: `Entry hash mismatch at ${e.eventId}`,
        };
      }
      prev = e.entryHash;
    }
    return { valid: true, eventCount: events.length, merkleRoot: prev };
  }

  getMerkleRoot(): string {
    return this.lastHash;
  }

  /** True Merkle root over entry hashes (C1). */
  buildMerkleRootFromEvents(events: ConfigProvenanceEvent[]): string {
    const leaves = events.map(e => leafHash(e.entryHash));
    return buildMerkleRoot(leaves);
  }

  createMerkleCheckpoint(events?: ConfigProvenanceEvent[]): string {
    const list = (events ?? this.store?.listProvenanceEvents?.(this.tenantId, 500) ?? [])
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as ConfigProvenanceEvent[];
    const root = this.buildMerkleRootFromEvents(list);
    this.store?.saveMerkleCheckpoint?.({
      checkpointId: `cp-${Date.now()}`,
      merkleRoot: root,
      eventCount: list.length,
    }, this.tenantId);
    return root;
  }

  proveEventInclusion(events: ConfigProvenanceEvent[], eventId: string): MerkleProof | null {
    const leaves = events.map(e => leafHash(e.entryHash));
    const idx = events.findIndex(e => e.eventId === eventId);
    if (idx < 0) return null;
    return merkleProof(leaves, idx);
  }

  verifyMerkleInclusion(proof: MerkleProof): boolean {
    return verifyMerkleProof(proof);
  }

  exportBundle(events: ConfigProvenanceEvent[]): {
    version: string;
    merkleRoot: string;
    eventCount: number;
    events: ConfigProvenanceEvent[];
    exportedAt: string;
  } {
    return {
      version: '1.0',
      merkleRoot: this.verify(events).merkleRoot,
      eventCount: events.length,
      events,
      exportedAt: new Date().toISOString(),
    };
  }
}

let _chain: ConfigProvenanceChain | null = null;

export function getConfigProvenanceChain(store?: IndustryStandardStore, tenantId = 'default'): ConfigProvenanceChain {
  if (!_chain || store) {
    _chain = new ConfigProvenanceChain(store, tenantId);
  }
  return _chain;
}

export function recordConfigProvenance(
  params: Parameters<ConfigProvenanceChain['append']>[0] & { store?: IndustryStandardStore; tenantId?: string },
): ConfigProvenanceEvent {
  const chain = getConfigProvenanceChain(params.store, params.tenantId);
  return chain.append(params);
}
