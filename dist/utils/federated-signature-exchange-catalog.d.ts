/**
 * Catalog helpers for federated signature exchange (split for testability).
 */
import type { ThreatSignature } from './fleet-threat-signatures.js';
export type SignatureHint = {
    signatureId: string;
    rule: string;
    tool: string;
    category: string;
    instanceCount: number;
    totalCount: number;
    message: string;
    firstSeen?: string;
};
export type RemoteSignatureCatalog = {
    signatures: Array<{
        signatureId: string;
        rule: string;
        tool: string;
        category: string;
        argShapeHash: string;
        instanceCount: number;
        eventCount: number;
        lastSeen: string;
    }>;
};
export declare function buildSignatureHints(catalog: RemoteSignatureCatalog, localIds: Set<string>, minInstances?: number): SignatureHint[];
export declare function catalogFromFleetRows(rows: Array<{
    signature_id: string;
    rule_name: string;
    tool_name: string;
    category: string;
    arg_shape_hash: string;
    instance_count: number;
    event_count: number;
    last_seen: string | Date;
}>): RemoteSignatureCatalog;
export type { ThreatSignature };
//# sourceMappingURL=federated-signature-exchange-catalog.d.ts.map