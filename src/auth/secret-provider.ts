/**
 * Secret Provider Interface (v2.3.4+)
 *
 * Abstracts sensitive configuration retrieval away from environment variables.
 * Ships with a default EnvSecretProvider that reads from process.env.
 * Swap in HashiCorpVaultProvider or AwsSecretsManagerProvider for production.
 *
 * Usage:
 *   const secrets = createSecretProvider();  // reads GUARDIAN_SECRET_PROVIDER env var
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
export class EnvSecretProvider implements SecretProvider {
  readonly name = 'env';

  async get(key: string): Promise<string | undefined> {
    return process.env[key];
  }

  async healthCheck(): Promise<boolean> {
    return true; // Always available
  }
}

/**
 * HashiCorp Vault provider (KV v2 engine).
 * Requires: VAULT_ADDR, VAULT_TOKEN, VAULT_MOUNT_PATH (optional, defaults to 'secret')
 * Reads from vault/${mountPath}/data/${key}
 */
export class HashiCorpVaultProvider implements SecretProvider {
  readonly name = 'hashicorp-vault';
  private vaultAddr: string;
  private vaultToken: string;
  private mountPath: string;

  constructor(options?: { vaultAddr?: string; vaultToken?: string; mountPath?: string }) {
    this.vaultAddr = options?.vaultAddr || process.env['VAULT_ADDR'] || 'http://localhost:8200';
    this.vaultToken = options?.vaultToken || process.env['VAULT_TOKEN'] || '';
    this.mountPath = options?.mountPath || process.env['VAULT_MOUNT_PATH'] || 'secret';
  }

  async get(key: string): Promise<string | undefined> {
    if (!this.vaultToken) return undefined;
    try {
      const url = `${this.vaultAddr}/v1/${this.mountPath}/data/${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        headers: { 'X-Vault-Token': this.vaultToken },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return undefined;
      const json = await res.json() as { data?: { data?: Record<string, unknown> } };
      const value = json?.data?.data?.value ?? json?.data?.data?.[key];
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.vaultAddr}/v1/sys/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      // Vault returns 200 (active), 429 (standby), 472/473 (DR/perf standby)
      // All indicate a healthy, unsealed node
      return res.ok || [429, 472, 473].includes(res.status);
    } catch {
      return false;
    }
  }
}

/**
 * AWS Secrets Manager provider.
 * Requires: AWS_REGION, and either AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or IAM role.
 * Reads from AWS Secrets Manager get-secret-value.
 */
export class AwsSecretsManagerProvider implements SecretProvider {
  readonly name = 'aws-secrets-manager';
  private region: string;

  constructor(options?: { region?: string }) {
    this.region = options?.region || process.env['AWS_REGION'] || 'us-east-1';
  }

  async get(key: string): Promise<string | undefined> {
    try {
      // Use AWS SDK v3 @aws-sdk/client-secrets-manager if available, otherwise HTTP
      // @ts-expect-error - @aws-sdk/client-secrets-manager is an optional peer dependency
      const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
      const client = new SecretsManagerClient({ region: this.region });
      const cmd = new GetSecretValueCommand({ SecretId: key });
      const response = await client.send(cmd);
      return response.SecretString;
    } catch {
      return undefined;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`https://secretsmanager.${this.region}.amazonaws.com/`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok || res.status === 403; // 403 means reachable but needs auth
    } catch {
      return false;
    }
  }
}

/**
 * Factory: creates the appropriate secret provider based on GUARDIAN_SECRET_PROVIDER env var.
 * Accepted values: 'env' (default), 'hashicorp-vault', 'aws-secrets-manager'
 */
export function createSecretProvider(): SecretProvider {
  const providerType = process.env['GUARDIAN_SECRET_PROVIDER'] || 'env';

  switch (providerType) {
    case 'hashicorp-vault':
      return new HashiCorpVaultProvider();
    case 'aws-secrets-manager':
      return new AwsSecretsManagerProvider();
    case 'env':
    default:
      return new EnvSecretProvider();
  }
}