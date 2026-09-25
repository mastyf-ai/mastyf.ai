import { type ThreatSignature } from './fleet-threat-signatures.js';
import { serializeBloomFilter, type BloomFilter } from './bloom-filter.js';
import { type RemoteSignatureCatalog } from './federated-signature-exchange-catalog.js';
import { buildFederatedShareRecords, type FederatedSignatureProvenance, type CompatibilityContext } from './federated-threat-intel-v2.js';
export type { SignatureHint, RemoteSignatureCatalog } from './federated-signature-exchange-catalog.js';
export { buildSignatureHints, catalogFromFleetRows } from './federated-signature-exchange-catalog.js';
export type SignatureExchangePayload = {
    localSignatures: ThreatSignature[];
    hints: import('./federated-signature-exchange-catalog.js').SignatureHint[];
    optIn: boolean;
    generatedAt: string;
    bloom?: ReturnType<typeof serializeBloomFilter>;
    privacyEpsilon: number;
};
export declare function buildLocalSignatureBloom(signatures: ThreatSignature[]): BloomFilter;
export declare function loadCachedFleetHints(): import('./federated-signature-exchange-catalog.js').SignatureHint[];
export declare function saveCachedFleetHints(hints: import('./federated-signature-exchange-catalog.js').SignatureHint[], bloom: BloomFilter): void;
export declare function fetchRemoteSignatureCatalog(): Promise<RemoteSignatureCatalog | null>;
export declare function syncFleetSignatureHintsFromCloud(): Promise<number>;
export declare function buildLocalSignatureExchange(remoteCatalog?: RemoteSignatureCatalog): Promise<SignatureExchangePayload>;
export declare function isSignatureKnownLocally(signatureId: string): boolean;
export declare function aggregateLocalWithFleet(local: ThreatSignature[], fleet: ThreatSignature[]): ThreatSignature[];
export declare function buildWeightedFleetHints(signatures: ThreatSignature[], provenanceById: Record<string, FederatedSignatureProvenance>, ctx: CompatibilityContext): ReturnType<typeof buildFederatedShareRecords>;
//# sourceMappingURL=federated-signature-exchange.d.ts.map