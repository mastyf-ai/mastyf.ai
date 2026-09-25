export declare function revokeBearerToken(token: string, jti?: string): Promise<void>;
export declare function isBearerTokenRevoked(token: string, jti?: string): Promise<boolean>;
export declare function cleanupRevokedTokens(): void;
/** @internal */
export declare function resetTokenRevocationForTests(): void;
//# sourceMappingURL=token-revocation.d.ts.map