export type OfflineLicensePayload = {
    v: number;
    product: string;
    sub?: string;
    email?: string;
    exp: number;
    iat?: number;
    seats?: number;
    mid?: string;
};
export type OfflineLicenseResult = {
    ok: boolean;
    reason?: string;
    payload?: OfflineLicensePayload;
    grace?: boolean;
    expiresAt?: string;
};
export declare function looksLikeLemonKey(token: string | undefined): boolean;
export declare function readOfflinePublicKey(pemOrPath: string | undefined): string;
export declare function verifyOfflineLicenseToken(token: string, publicPem: string, nowMs?: number, machineId?: string): OfflineLicenseResult;
//# sourceMappingURL=offline-license.d.ts.map