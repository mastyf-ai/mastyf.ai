export interface SamlConfig {
    id: string;
    tenantId: string;
    name: string;
    issuerUrl: string;
    entryPoint: string;
    cert: string;
    privateKey?: string;
    redirectUri: string;
    claimMappings: {
        email: string;
        displayName: string;
        groups?: string;
    };
    roleMap: Record<string, string>;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}
export declare function generateSamlRequestUrl(config: SamlConfig): {
    url: string;
    relayState: string;
};
export declare function parseSamlResponse(samlResponse: string, config: SamlConfig, expectedRelayState: string): Promise<{
    email: string;
    displayName: string;
    groups: string[];
    nameId: string;
} | null>;
//# sourceMappingURL=saml-provider.d.ts.map