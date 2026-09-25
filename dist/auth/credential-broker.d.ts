interface StoredCredential {
    id: string;
    tenantId: string;
    userId: string;
    providerName: string;
    providerId: string;
    credentialType: 'oauth2' | 'api_key' | 'bearer_token';
    encryptedToken: string;
    encryptedRefreshToken?: string;
    scopes: string[];
    expiresAt: number | null;
    createdAt: string;
    metadata: Record<string, string>;
}
interface InjectedCredential {
    token: string;
    tokenType: string;
    scopes: string[];
    expiresAt?: number;
}
export declare class CredentialBroker {
    private credentialCache;
    storeCredential(params: {
        tenantId: string;
        userId: string;
        providerName: string;
        providerId: string;
        credentialType: 'oauth2' | 'api_key' | 'bearer_token';
        token: string;
        refreshToken?: string;
        scopes: string[];
        expiresAt?: number;
        metadata?: Record<string, string>;
    }): Promise<string>;
    getCredential(tenantId: string, providerId: string, credentialType: string): Promise<InjectedCredential | null>;
    injectCredentialIntoHeaders(tenantId: string, providerName: string, credentialType: string, headers: Record<string, string>): Promise<Record<string, string>>;
    stripCredentialsFromResponse(responseBody: string): Promise<string>;
    revokeCredential(credentialId: string): Promise<boolean>;
    listCredentialsForUser(tenantId: string, userId: string): Promise<Omit<StoredCredential, 'encryptedToken' | 'encryptedRefreshToken'>[]>;
}
export declare const credentialBroker: CredentialBroker;
export {};
//# sourceMappingURL=credential-broker.d.ts.map