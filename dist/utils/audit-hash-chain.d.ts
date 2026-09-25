export declare function isAuditHashChainEnabled(): boolean;
export declare function isSiemAuditHashChainEnabled(): boolean;
export declare function resolveSiemAuditChainPath(): string;
/** Append a SIEM/security event to the chained JSONL trail (best-effort). */
export declare function appendSiemChainedEvent(type: string, payload: Record<string, unknown>): void;
export interface ChainedAuditLine {
    prev_hash: string;
    entry_hash: string;
    record: Record<string, unknown>;
}
export declare function computeEntryHash(prevHash: string, payloadJson: string): string;
export declare class AuditHashChain {
    private lastHash;
    constructor(initialHash?: string);
    getLastHash(): string;
    /** Append payload; returns line object including chain fields. */
    append(payload: Record<string, unknown>): ChainedAuditLine;
}
/** Load last entry_hash from JSONL file or genesis. */
export declare function loadChainTipFromJsonl(filePath: string): string;
export declare function appendChainedJsonlLine(filePath: string, payload: Record<string, unknown>): ChainedAuditLine;
/** Verify an in-memory or on-disk trail; returns first invalid index or -1 if valid. */
export declare function verifyChainedJsonlLines(lines: ChainedAuditLine[]): number;
//# sourceMappingURL=audit-hash-chain.d.ts.map