/**
 * C1 — Config Provenance & Verifiable Audit Chain (Merkle-linked events).
 */
import { createHash, randomUUID } from 'crypto';
import { appendSiemChainedEvent } from '../../utils/audit-hash-chain.js';
import { buildMerkleRoot, leafHash, merkleProof, verifyMerkleProof } from './merkle-tree.js';
const CHECKPOINT_INTERVAL = 16;
const GENESIS = createHash('sha256').update('mastyf-ai-config-provenance-genesis').digest('hex');
function hashEntry(prevHash, payload) {
    return createHash('sha256').update(`${prevHash}\n${payload}`).digest('hex');
}
export class ConfigProvenanceChain {
    store;
    tenantId;
    lastHash = GENESIS;
    eventCount = 0;
    constructor(store, tenantId = 'default') {
        this.store = store;
        this.tenantId = tenantId;
        const latest = store?.getLatestProvenanceHash?.(tenantId);
        if (latest)
            this.lastHash = latest;
    }
    append(params) {
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
        const event = {
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
    verify(events) {
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
    getMerkleRoot() {
        return this.lastHash;
    }
    /** True Merkle root over entry hashes (C1). */
    buildMerkleRootFromEvents(events) {
        const leaves = events.map(e => leafHash(e.entryHash));
        return buildMerkleRoot(leaves);
    }
    createMerkleCheckpoint(events) {
        const list = (events ?? this.store?.listProvenanceEvents?.(this.tenantId, 500) ?? [])
            .slice()
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const root = this.buildMerkleRootFromEvents(list);
        this.store?.saveMerkleCheckpoint?.({
            checkpointId: `cp-${Date.now()}`,
            merkleRoot: root,
            eventCount: list.length,
        }, this.tenantId);
        return root;
    }
    proveEventInclusion(events, eventId) {
        const leaves = events.map(e => leafHash(e.entryHash));
        const idx = events.findIndex(e => e.eventId === eventId);
        if (idx < 0)
            return null;
        return merkleProof(leaves, idx);
    }
    verifyMerkleInclusion(proof) {
        return verifyMerkleProof(proof);
    }
    exportBundle(events) {
        return {
            version: '1.0',
            merkleRoot: this.verify(events).merkleRoot,
            eventCount: events.length,
            events,
            exportedAt: new Date().toISOString(),
        };
    }
}
let _chain = null;
export function getConfigProvenanceChain(store, tenantId = 'default') {
    if (!_chain || store) {
        _chain = new ConfigProvenanceChain(store, tenantId);
    }
    return _chain;
}
export function recordConfigProvenance(params) {
    const chain = getConfigProvenanceChain(params.store, params.tenantId);
    return chain.append(params);
}
//# sourceMappingURL=config-provenance-chain.js.map