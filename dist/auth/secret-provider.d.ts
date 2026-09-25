/**
 * Secret Provider Interface (v2.3.4+)
 *
 * Abstracts sensitive configuration retrieval away from environment variables.
 * Ships with a default EnvSecretProvider that reads from process.env.
 * Swap in HashiCorpVaultProvider or AwsSecretsManagerProvider for production.
 *
 * Usage:
 *   const secrets = createSecretProvider();  // reads MASTYF_AI_SECRET_PROVIDER env var
 *   const oauthKey = await secrets.get('OAUTH_CLIENT_SECRET');
 */
export interface SecretProvider {
    /** Retrieve a secret value. Returns undefined if not found. */
    get(key: string): Promise<string | undefined>;
    /** Check if the provider is healthy/connected. */
    healthCheck(): Promise<boolean>;
    /** Human-readable provider name for logging. */
    readonly name: string;
}
/**
 * Default provider: reads from process.env.
 * Suitable for development and single-instance deployments.
 */
export declare class EnvSecretProvider implements SecretProvider {
    readonly name = "env";
    get(key: string): Promise<string | undefined>;
    healthCheck(): Promise<boolean>;
}
/**
 * HashiCorp Vault provider (KV v2 engine).
 * Requires: VAULT_ADDR, VAULT_TOKEN, VAULT_MOUNT_PATH (optional, defaults to 'secret')
 * Reads from vault/${mountPath}/data/${key}
 */
export declare class HashiCorpVaultProvider implements SecretProvider {
    readonly name = "hashicorp-vault";
    private vaultAddr;
    private vaultToken;
    private mountPath;
    constructor(options?: {
        vaultAddr?: string;
        vaultToken?: string;
        mountPath?: string;
    });
    get(key: string): Promise<string | undefined>;
    healthCheck(): Promise<boolean>;
}
/**
 * AWS Secrets Manager provider.
 * Requires: AWS_REGION, and either AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or IAM role.
 * Reads from AWS Secrets Manager get-secret-value.
 */
export declare class AwsSecretsManagerProvider implements SecretProvider {
    readonly name = "aws-secrets-manager";
    private region;
    constructor(options?: {
        region?: string;
    });
    get(key: string): Promise<string | undefined>;
    healthCheck(): Promise<boolean>;
}
/**
 * GCP Secret Manager provider.
 * Requires: GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT, plus Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.
 * SecretId is the env key name (e.g. ANTHROPIC_API_KEY).
 */
export declare class GcpSecretManagerProvider implements SecretProvider {
    readonly name = "gcp-secret-manager";
    private projectId;
    constructor(options?: {
        projectId?: string;
    });
    get(key: string): Promise<string | undefined>;
    healthCheck(): Promise<boolean>;
}
/**
 * Factory: creates the appropriate secret provider based on MASTYF_AI_SECRET_PROVIDER env var.
 * Accepted values: 'env' (default), 'hashicorp-vault', 'aws-secrets-manager', 'gcp-secret-manager'
 */
export declare function createSecretProvider(): SecretProvider;
export declare function isManagedSecretProviderConfigured(): boolean;
//# sourceMappingURL=secret-provider.d.ts.map