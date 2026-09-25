import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import { type MerkleProof } from './merkle-tree.js';
export type ConfigProvenanceEventType = 'policy_apply' | 'policy_reload' | 'policy_approve' | 'policy_deny' | 'config_edit';
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
export declare class ConfigProvenanceChain {
    private readonly store?;
    private readonly tenantId;
    private lastHash;
    private eventCount;
    constructor(store?: IndustryStandardStore | undefined, tenantId?: string);
    append(params: {
        actor: string;
        eventType: ConfigProvenanceEventType;
        resourcePath: string;
        diff?: Record<string, unknown>;
        signature?: string;
        approvalId?: string;
    }): ConfigProvenanceEvent;
    verify(events: ConfigProvenanceEvent[]): ProvenanceVerifyResult;
    getMerkleRoot(): string;
    /** True Merkle root over entry hashes (C1). */
    buildMerkleRootFromEvents(events: ConfigProvenanceEvent[]): string;
    createMerkleCheckpoint(events?: ConfigProvenanceEvent[]): string;
    proveEventInclusion(events: ConfigProvenanceEvent[], eventId: string): MerkleProof | null;
    verifyMerkleInclusion(proof: MerkleProof): boolean;
    exportBundle(events: ConfigProvenanceEvent[]): {
        version: string;
        merkleRoot: string;
        eventCount: number;
        events: ConfigProvenanceEvent[];
        exportedAt: string;
    };
}
export declare function getConfigProvenanceChain(store?: IndustryStandardStore, tenantId?: string): ConfigProvenanceChain;
export declare function recordConfigProvenance(params: Parameters<ConfigProvenanceChain['append']>[0] & {
    store?: IndustryStandardStore;
    tenantId?: string;
}): ConfigProvenanceEvent;
//# sourceMappingURL=config-provenance-chain.d.ts.map