export type CiTokenPayload = {
    sub: string;
    iat: number;
    exp: number;
    features?: string[];
};
/** Verify a CI token against the embedded public key. Returns the payload or null. */
export declare function verifyCiToken(): Promise<CiTokenPayload | null>;
/** Lightweight synchronous check: is a valid token cached? */
export declare function isCiTokenCached(): boolean;
/** Check if the current process has a valid CI token (runs verification on first call, caches result). */
export declare function isCiLicenseTokenValid(): Promise<boolean>;
/** Clear the verification cache (for tests). */
export declare function resetCiTokenCache(): void;
//# sourceMappingURL=ci-token.d.ts.map