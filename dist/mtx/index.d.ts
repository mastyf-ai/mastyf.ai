export declare const MTX_VERSION: "1.0";
export interface MtxRecordV1 {
    mtxVersion: typeof MTX_VERSION;
    signatureHash: string;
    toolPattern: string;
    argPatternHash: string;
    category: string;
    blockReason: string;
    corpusId?: string;
    reportCount: number;
    firstSeen: string;
    lastSeen: string;
    deploymentSalt?: string;
}
export declare function hashSignature(input: string): string;
export declare function buildMtxRecord(params: {
    toolName: string;
    argFingerprint: string;
    category: string;
    blockReason: string;
    corpusId?: string;
    reportCount?: number;
    deploymentSalt?: string;
}): MtxRecordV1;
export declare function serializeMtxRecord(record: MtxRecordV1): string;
//# sourceMappingURL=index.d.ts.map