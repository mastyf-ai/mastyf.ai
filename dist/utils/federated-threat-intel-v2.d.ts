import type { ThreatSignature } from './fleet-threat-signatures.js';
export interface FederatedSignatureProvenance {
    sourceRegion: string;
    firstSeenAt: string;
    lastSeenAt: string;
    evidenceCount: number;
    confidence: number;
}
export interface FederatedSignatureShareRecord {
    signatureId: string;
    rule: string;
    tool: string;
    category: string;
    argShapeHash: string;
    provenance: FederatedSignatureProvenance;
    decayWeight: number;
    compatibilityWeight: number;
    finalWeight: number;
}
export interface CompatibilityContext {
    region?: string;
    toolUsageSet: Set<string>;
    categoryUsageSet: Set<string>;
}
export declare function computeDecayWeight(lastSeenAt: string, halfLifeDays?: number): number;
export declare function computeCompatibilityWeight(sig: Pick<ThreatSignature, 'tool' | 'category'>, ctx: CompatibilityContext): number;
export declare function buildFederatedShareRecords(signatures: ThreatSignature[], provenanceById: Record<string, FederatedSignatureProvenance>, ctx: CompatibilityContext): FederatedSignatureShareRecord[];
//# sourceMappingURL=federated-threat-intel-v2.d.ts.map