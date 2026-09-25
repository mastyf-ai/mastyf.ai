import type { IdpConfig, OidcDiscovery, OidcTokens, OidcIdTokenClaims, FederatedUserData } from './federation-types.js';
declare function discoverOidc(issuerUrl: string): Promise<OidcDiscovery>;
export declare function generateState(): string;
export declare function generateCodeVerifier(): string;
export declare function generateNonce(): string;
export declare function computeCodeChallenge(verifier: string): string;
export declare function buildAuthorizationUrl(config: IdpConfig, discovery: OidcDiscovery, state: string, codeChallenge: string, nonce: string): string;
export declare function exchangeCodeForTokens(config: IdpConfig, discovery: OidcDiscovery, code: string, codeVerifier: string, state: string): Promise<OidcTokens>;
export declare function decodeBase64JwtPayload(jwt: string): Record<string, unknown>;
export declare function validateIdToken(idToken: string, config: IdpConfig, discovery: OidcDiscovery, expectedNonce: string): Promise<OidcIdTokenClaims>;
export declare function fetchUserinfo(discovery: OidcDiscovery, accessToken: string): Promise<Record<string, unknown> | null>;
export declare function extractFederatedUserData(config: IdpConfig, idTokenClaims: OidcIdTokenClaims, userinfo: Record<string, unknown> | null, tokens: OidcTokens): FederatedUserData;
export declare function startOidcLogin(config: IdpConfig): Promise<{
    authorizationUrl: string;
    state: string;
    codeVerifier: string;
    nonce: string;
}>;
export declare function handleOidcCallback(config: IdpConfig, code: string, state: string, expectedState: string, codeVerifier: string, expectedNonce: string): Promise<FederatedUserData>;
export { discoverOidc };
//# sourceMappingURL=oidc-provider.d.ts.map