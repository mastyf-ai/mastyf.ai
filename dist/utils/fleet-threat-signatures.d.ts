export type ThreatSignature = {
    signatureId: string;
    rule: string;
    tool: string;
    category: string;
    argShapeHash: string;
    count: number;
    lastSeen: string;
    region?: string;
};
export type ThreatSignatureInput = {
    rule: string;
    tool: string;
    category?: string;
    argKeys?: string[];
    region?: string;
};
export declare function argShapeFromKeys(keys: string[]): string;
export declare function buildThreatSignature(input: ThreatSignatureInput, count?: number): ThreatSignature;
export declare function mergeThreatSignatures(existing: ThreatSignature[], incoming: ThreatSignature[]): ThreatSignature[];
export declare function aggregateThreatSignaturesFromBlocks(blocks: Array<{
    rule?: string;
    tool?: string;
    category?: string;
    argKeys?: string[];
}>, region?: string): ThreatSignature[];
export declare function collectHeartbeatThreatSignatures(): Promise<ThreatSignature[]>;
export type FleetThreatAlert = {
    signatureId: string;
    regionCount: number;
    totalCount: number;
    message: string;
};
/** Alert when the same signature appears in 3+ regions within the window. */
export declare function detectCrossRegionThreatAlerts(byRegion: Map<string, ThreatSignature[]>, minRegions?: number): FleetThreatAlert[];
//# sourceMappingURL=fleet-threat-signatures.d.ts.map