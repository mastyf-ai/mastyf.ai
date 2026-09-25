export declare function getMaxPayloadBytes(): number;
export declare function getMaxExpandedPayloadBytes(): number;
export declare function utf8ByteLength(value: string): number;
export declare function measureJsonUtf8Bytes(value: unknown): number;
export type PayloadGuardResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
    code: 'raw_oversize' | 'expanded_oversize';
};
export declare function checkRawPayloadSize(raw: string | Buffer): PayloadGuardResult;
export declare function checkExpandedPayload(args: unknown): PayloadGuardResult;
//# sourceMappingURL=payload-guard.d.ts.map