export interface AuditAttestationStatus {
    ok: boolean;
    lastCheckpointAt?: string;
    lastCheckpointHash?: string;
    sinkPath?: string;
    reason?: string;
}
export declare function resolveAttestationSinkPath(): string;
export declare function checkpointAuditChain(entryHash: string): AuditAttestationStatus;
export declare function getAuditAttestationStatus(): AuditAttestationStatus;
//# sourceMappingURL=audit-attestation.d.ts.map