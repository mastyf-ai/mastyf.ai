import { Agent as HttpsAgent } from 'https';
/** Active SPIFFE ID from env or client cert subject (spiffe://…). */
export declare function getActiveSpiffeId(): string | undefined;
export declare function resetSpiffeSvidCacheForTests(): void;
/**
 * Fetch X.509 SVID from SPIFFE Workload API (HTTP over Unix socket).
 * Sets MCP_TLS_CA, MCP_TLS_CERT, MCP_TLS_KEY when successful.
 */
export declare function fetchSpiffeSvidFromWorkloadApi(): Promise<boolean>;
export interface MtlsConfig {
    enabled: boolean;
    ca?: Buffer;
    cert?: Buffer;
    key?: Buffer;
    rejectUnauthorized: boolean;
}
/**
 * Load mTLS configuration from environment variables.
 */
export declare function loadMtlsConfig(): MtlsConfig;
/**
 * Create an HTTPS Agent configured with mTLS client certificate and CA.
 */
export declare function createMtlsAgent(config: MtlsConfig): HttpsAgent | undefined;
/**
 * CLI flag names for mTLS configuration.
 */
/** Default mount paths when using Helm mtls.existingSecret volume. */
export declare const MTLS_HELM_MOUNT_PATHS: {
    readonly ca: "/etc/mastyf-ai/tls/ca.pem";
    readonly cert: "/etc/mastyf-ai/tls/tls.crt";
    readonly key: "/etc/mastyf-ai/tls/tls.key";
};
/**
 * Apply Helm-style mount paths when MCP_TLS_* are unset but files exist at defaults.
 */
export declare function resolveMtlsEnvFromMounts(): void;
export declare const MTL_CLI_FLAGS: {
    readonly tlsEnabled: "--mtls";
    readonly tlsCa: "--mtls-ca <path>";
    readonly tlsCert: "--mtls-cert <path>";
    readonly tlsKey: "--mtls-key <path>";
    readonly tlsInsecure: "--mtls-insecure";
};
//# sourceMappingURL=mtls-config.d.ts.map