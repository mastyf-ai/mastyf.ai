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
/**
 * Default provider: reads from process.env.
 * Suitable for development and single-instance deployments.
 */
export class EnvSecretProvider {
    name = 'env';
    async get(key) {
        return process.env[key];
    }
    async healthCheck() {
        return true; // Always available
    }
}
/**
 * HashiCorp Vault provider (KV v2 engine).
 * Requires: VAULT_ADDR, VAULT_TOKEN, VAULT_MOUNT_PATH (optional, defaults to 'secret')
 * Reads from vault/${mountPath}/data/${key}
 */
export class HashiCorpVaultProvider {
    name = 'hashicorp-vault';
    vaultAddr;
    vaultToken;
    mountPath;
    constructor(options) {
        this.vaultAddr = options?.vaultAddr || process.env['VAULT_ADDR'] || 'http://localhost:8200';
        this.vaultToken = options?.vaultToken || process.env['VAULT_TOKEN'] || '';
        this.mountPath = options?.mountPath || process.env['VAULT_MOUNT_PATH'] || 'secret';
    }
    async get(key) {
        if (!this.vaultToken)
            return undefined;
        try {
            const url = `${this.vaultAddr}/v1/${this.mountPath}/data/${encodeURIComponent(key)}`;
            const res = await fetch(url, {
                headers: { 'X-Vault-Token': this.vaultToken },
                signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok)
                return undefined;
            const json = await res.json();
            const value = json?.data?.data?.value ?? json?.data?.data?.[key];
            return typeof value === 'string' ? value : undefined;
        }
        catch {
            return undefined;
        }
    }
    async healthCheck() {
        try {
            const res = await fetch(`${this.vaultAddr}/v1/sys/health`, {
                signal: AbortSignal.timeout(3_000),
            });
            // Vault returns 200 (active), 429 (standby), 472/473 (DR/perf standby)
            // All indicate a healthy, unsealed node
            return res.ok || [429, 472, 473].includes(res.status);
        }
        catch {
            return false;
        }
    }
}
/**
 * AWS Secrets Manager provider.
 * Requires: AWS_REGION, and either AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or IAM role.
 * Reads from AWS Secrets Manager get-secret-value.
 */
export class AwsSecretsManagerProvider {
    name = 'aws-secrets-manager';
    region;
    constructor(options) {
        this.region = options?.region || process.env['AWS_REGION'] || 'us-east-1';
    }
    async get(key) {
        try {
            // Use AWS SDK v3 @aws-sdk/client-secrets-manager if available, otherwise HTTP
            // @ts-expect-error - @aws-sdk/client-secrets-manager is an optional peer dependency
            const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
            const client = new SecretsManagerClient({ region: this.region });
            const cmd = new GetSecretValueCommand({ SecretId: key });
            const response = await client.send(cmd);
            return response.SecretString;
        }
        catch {
            return undefined;
        }
    }
    async healthCheck() {
        try {
            const res = await fetch(`https://secretsmanager.${this.region}.amazonaws.com/`, {
                method: 'HEAD',
                signal: AbortSignal.timeout(3_000),
            });
            return res.ok || res.status === 403; // 403 means reachable but needs auth
        }
        catch {
            return false;
        }
    }
}
/**
 * GCP Secret Manager provider.
 * Requires: GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT, plus Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.
 * SecretId is the env key name (e.g. ANTHROPIC_API_KEY).
 */
export class GcpSecretManagerProvider {
    name = 'gcp-secret-manager';
    projectId;
    constructor(options) {
        this.projectId =
            options?.projectId
                || process.env['GCP_PROJECT_ID']
                || process.env['GOOGLE_CLOUD_PROJECT']
                || '';
    }
    async get(key) {
        if (!this.projectId)
            return undefined;
        try {
            // @ts-expect-error - @google-cloud/secret-manager is an optional peer dependency
            const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
            const client = new SecretManagerServiceClient();
            const name = `projects/${this.projectId}/secrets/${encodeURIComponent(key)}/versions/latest`;
            const [version] = await client.accessSecretVersion({ name });
            const data = version.payload?.data;
            if (typeof data === 'string')
                return data;
            if (data instanceof Uint8Array)
                return Buffer.from(data).toString('utf8');
            return undefined;
        }
        catch {
            return undefined;
        }
    }
    async healthCheck() {
        return Boolean(this.projectId);
    }
}
/**
 * Factory: creates the appropriate secret provider based on MASTYF_AI_SECRET_PROVIDER env var.
 * Accepted values: 'env' (default), 'hashicorp-vault', 'aws-secrets-manager', 'gcp-secret-manager'
 */
export function createSecretProvider() {
    const providerType = process.env['MASTYF_AI_SECRET_PROVIDER'] || 'env';
    switch (providerType) {
        case 'hashicorp-vault':
            return new HashiCorpVaultProvider();
        case 'aws-secrets-manager':
            return new AwsSecretsManagerProvider();
        case 'gcp-secret-manager':
            return new GcpSecretManagerProvider();
        case 'env':
        default:
            return new EnvSecretProvider();
    }
}
export function isManagedSecretProviderConfigured() {
    const providerType = process.env['MASTYF_AI_SECRET_PROVIDER'] || 'env';
    return providerType !== 'env';
}
//# sourceMappingURL=secret-provider.js.map