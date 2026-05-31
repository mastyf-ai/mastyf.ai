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
import { readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { request as httpRequest } from 'http';
import { Agent as HttpsAgent } from 'https';
import { Logger } from './logger.js';
import { applyCertPinToAgentOptions } from './upstream-cert-pin.js';

let spiffeLoaded = false;

/** Active SPIFFE ID from env or client cert subject (spiffe://…). */
export function getActiveSpiffeId(): string | undefined {
  const fromEnv = process.env['GUARDIAN_SPIFFE_ID']?.trim();
  if (fromEnv?.startsWith('spiffe://')) return fromEnv;
  const certPath = process.env['MCP_TLS_CERT'];
  if (!certPath) return undefined;
  try {
    const pem = readFileSync(certPath, 'utf-8');
    const match = pem.match(/spiffe:\/\/[^\s/]+/);
    return match?.[0];
  } catch {
    return undefined;
  }
}

export function resetSpiffeSvidCacheForTests(): void {
  spiffeLoaded = false;
  delete process.env['MCP_TLS_CA'];
  delete process.env['MCP_TLS_CERT'];
  delete process.env['MCP_TLS_KEY'];
}

/**
 * Fetch X.509 SVID from SPIFFE Workload API (HTTP over Unix socket).
 * Sets MCP_TLS_CA, MCP_TLS_CERT, MCP_TLS_KEY when successful.
 */
export async function fetchSpiffeSvidFromWorkloadApi(): Promise<boolean> {
  const socketPath = process.env['GUARDIAN_SPIFFE_SOCKET_PATH']?.trim();
  if (!socketPath || spiffeLoaded) return spiffeLoaded;

  return new Promise((resolve) => {
    const req = httpRequest(
      {
        socketPath,
        path: '/v1/agent/x509',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as {
              svids?: Array<{ x509_svid?: string; private_key?: string }>;
              federated_bundles?: Record<string, string>;
            };
            const svid = parsed.svids?.[0];
            if (!svid?.x509_svid || !svid.private_key) {
              Logger.warn('[spiffe] Workload API returned no SVID');
              resolve(false);
              return;
            }
            process.env['MCP_TLS_CERT'] = writeTempPem('cert', svid.x509_svid);
            process.env['MCP_TLS_KEY'] = writeTempPem('key', svid.private_key);
            const bundle = Object.values(parsed.federated_bundles || {})[0];
            if (bundle) {
              process.env['MCP_TLS_CA'] = writeTempPem('ca', bundle);
            }
            process.env['MCP_TLS_ENABLED'] = 'true';
            spiffeLoaded = true;
            Logger.info('[spiffe] Loaded SVID from workload API');
            resolve(true);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.warn(`[spiffe] Failed to parse workload API response: ${message}`);
            resolve(false);
          }
        });
      },
    );
    req.on('error', (err) => {
      Logger.warn(`[spiffe] Workload API unreachable: ${err.message}`);
      resolve(false);
    });
    req.end();
  });
}

function writeTempPem(kind: string, pemBody: string): string {
  const dir = mkdtempSync(join(tmpdir(), `guardian-spiffe-${kind}-`));
  const filePath = join(dir, `${kind}.pem`);
  let normalized = pemBody;
  if (!pemBody.includes('BEGIN')) {
    if (kind === 'key') {
      normalized = `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----`;
    } else {
      normalized = `-----BEGIN CERTIFICATE-----\n${pemBody}\n-----END CERTIFICATE-----`;
    }
  }
  writeFileSync(filePath, normalized);
  return filePath;
}

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
  resolveMtlsEnvFromMounts();
  if (process.env['GUARDIAN_SPIFFE_SOCKET_PATH'] && !spiffeLoaded) {
    Logger.info('[spiffe] GUARDIAN_SPIFFE_SOCKET_PATH set — call fetchSpiffeSvidFromWorkloadApi() before loadMtlsConfig in async bootstrap');
  }
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
  if (!config.enabled) {
    const pinOnly = process.env['GUARDIAN_UPSTREAM_CERT_PIN_SHA256']?.trim();
    if (!pinOnly) return undefined;
    const opts = applyCertPinToAgentOptions({
      rejectUnauthorized: true,
      keepAlive: true,
      keepAliveMsecs: 30000,
    });
    return new HttpsAgent(opts);
  }

  const opts = applyCertPinToAgentOptions({
    ca: config.ca,
    cert: config.cert,
    key: config.key,
    rejectUnauthorized: config.rejectUnauthorized,
    keepAlive: true,
    keepAliveMsecs: 30000,
  });
  return new HttpsAgent(opts);
}

/**
 * CLI flag names for mTLS configuration.
 */
/** Default mount paths when using Helm mtls.existingSecret volume. */
export const MTLS_HELM_MOUNT_PATHS = {
  ca: '/etc/mcp-guardian/tls/ca.pem',
  cert: '/etc/mcp-guardian/tls/tls.crt',
  key: '/etc/mcp-guardian/tls/tls.key',
} as const;

/**
 * Apply Helm-style mount paths when MCP_TLS_* are unset but files exist at defaults.
 */
export function resolveMtlsEnvFromMounts(): void {
  if (process.env['MCP_TLS_ENABLED'] !== 'true') return;
  if (!process.env['MCP_TLS_CA'] && fileExists(MTLS_HELM_MOUNT_PATHS.ca)) {
    process.env['MCP_TLS_CA'] = MTLS_HELM_MOUNT_PATHS.ca;
  }
  if (!process.env['MCP_TLS_CERT'] && fileExists(MTLS_HELM_MOUNT_PATHS.cert)) {
    process.env['MCP_TLS_CERT'] = MTLS_HELM_MOUNT_PATHS.cert;
  }
  if (!process.env['MCP_TLS_KEY'] && fileExists(MTLS_HELM_MOUNT_PATHS.key)) {
    process.env['MCP_TLS_KEY'] = MTLS_HELM_MOUNT_PATHS.key;
  }
}

function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

export const MTL_CLI_FLAGS = {
  tlsEnabled: '--mtls',
  tlsCa: '--mtls-ca <path>',
  tlsCert: '--mtls-cert <path>',
  tlsKey: '--mtls-key <path>',
  tlsInsecure: '--mtls-insecure',
} as const;