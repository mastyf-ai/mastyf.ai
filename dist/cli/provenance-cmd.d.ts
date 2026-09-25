export declare function runProvenanceVerify(tenantId?: string): Promise<{
    valid: boolean;
    eventCount: number;
    merkleRoot: string;
    reason?: string;
}>;
export declare function runProvenanceExport(tenantId?: string, opts?: {
    format?: 'json' | 'signed' | 'tarball';
    output?: string;
}): Promise<unknown>;
//# sourceMappingURL=provenance-cmd.d.ts.map