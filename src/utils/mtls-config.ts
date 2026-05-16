/**
 * mTLS Configuration for Zero-Trust Proxy ↔ Upstream Communication.
 *
 * When MCP_TLS_ENABLED=true, the HTTP/SSE proxy validates the upstream
 * server's certificate AND presents a client certificate for mutual
 * authentication. This prevents MITM attacks and ensures only authorized
 * proxies can connect to upstream MCP servers.
 *
 * Configuration via environment variables:
 *   MCP_TLS_ENABLED=true|false
 *   MCP_TLS_CA=/path/to/ca-cert.pem        (required — trusted CA bundle)
 *   MCP_TLS_CERT=/path/to/client-cert.pem   (required — proxy's client cert)
 *   MCP_TLS_KEY=/path/to/client-key.pem     (required — proxy's client key)
 *   MCP_TLS_REJECT_UNAUTHORIZED=true|false  (default: true — strict mode)
 *
 * Certificate rotation requires process/pod restart until hot-reload ships
 * (see docs/MTLS.md and src/utils/mtls-watcher.ts).
 */
import { readFileSync } from 'fs';
import { Agent as HttpsAgent } from 'https';
import { Logger } from './logger.js';

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
export function loadMtlsConfig(): MtlsConfig {
  const enabled = process.env['MCP_TLS_ENABLED'] === 'true';

  if (!enabled) {
    return { enabled: false, rejectUnauthorized: true };
  }

  const caPath = process.env['MCP_TLS_CA'];
  const certPath = process.env['MCP_TLS_CERT'];
  const keyPath = process.env['MCP_TLS_KEY'];
  const rejectUnauthorized = process.env['MCP_TLS_REJECT_UNAUTHORIZED'] !== 'false';

  const missing: string[] = [];
  if (!caPath) missing.push('MCP_TLS_CA');
  if (!certPath) missing.push('MCP_TLS_CERT');
  if (!keyPath) missing.push('MCP_TLS_KEY');

  if (missing.length > 0) {
    Logger.error(`[mtls] mTLS enabled but missing env vars: ${missing.join(', ')}`);
    throw new Error(`mTLS misconfigured: missing ${missing.join(', ')}`);
  }

  let ca: Buffer | undefined;
  let cert: Buffer | undefined;
  let key: Buffer | undefined;

  try {
    ca = readFileSync(caPath!);
    cert = readFileSync(certPath!);
    key = readFileSync(keyPath!);
  } catch (err: any) {
    Logger.error(`[mtls] Failed to read TLS files: ${err?.message}`);
    throw err;
  }

  Logger.info(`[mtls] mTLS enabled (CA: ${caPath}, cert: ${certPath}, rejectUnauthorized: ${rejectUnauthorized})`);

  return { enabled: true, ca, cert, key, rejectUnauthorized };
}

/**
 * Create an HTTPS Agent configured with mTLS client certificate and CA.
 */
export function createMtlsAgent(config: MtlsConfig): HttpsAgent | undefined {
  if (!config.enabled) return undefined;

  return new HttpsAgent({
    ca: config.ca,
    cert: config.cert,
    key: config.key,
    rejectUnauthorized: config.rejectUnauthorized,
    keepAlive: true,
    keepAliveMsecs: 30000,
  });
}

/**
 * CLI flag names for mTLS configuration.
 */
export const MTL_CLI_FLAGS = {
  tlsEnabled: '--mtls',
  tlsCa: '--mtls-ca <path>',
  tlsCert: '--mtls-cert <path>',
  tlsKey: '--mtls-key <path>',
  tlsInsecure: '--mtls-insecure',
} as const;