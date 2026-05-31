/**
 * MCP Guardian Plugin SDK v4.0 — detector plugins + industry-standard hooks.
 * @see docs/PLUGIN_SDK.md
 */

export type DetectorSeverity = 'HIGH' | 'MEDIUM' | 'high' | 'medium';

export interface DetectorScanContext {
  serverName?: string;
  toolName?: string;
  location?: string;
}

export interface DetectorFinding {
  type: string;
  location: string;
  severity: DetectorSeverity;
  redacted?: string;
  context?: string;
  method?: 'regex' | 'heuristic' | 'llm' | string;
}

export interface DetectorPluginLifecycle {
  onLoad?(): void | Promise<void>;
  onUnload?(): void | Promise<void>;
}

export interface DetectorPlugin extends DetectorPluginLifecycle {
  name: string;
  version?: string;
  scanArguments(text: string, ctx: DetectorScanContext): DetectorFinding[] | Promise<DetectorFinding[]>;
}

export interface CreatePluginOptions {
  name: string;
  version?: string;
  scanArguments: DetectorPlugin['scanArguments'];
  onLoad?: DetectorPluginLifecycle['onLoad'];
  onUnload?: DetectorPluginLifecycle['onUnload'];
}

export function createDetectorPlugin(opts: CreatePluginOptions): DetectorPlugin {
  return {
    name: opts.name,
    version: opts.version,
    onLoad: opts.onLoad,
    onUnload: opts.onUnload,
    scanArguments: opts.scanArguments,
  };
}

export const PLUGIN_SDK_VERSION = '4.0.0';

/** Build MTX v1 record JSON for threat mesh contribution from a plugin finding. */
export function exportMtxRecord(params: {
  toolName: string;
  argFingerprint: string;
  category: string;
  blockReason: string;
}): string {
  const record = {
    mtxVersion: '1.0',
    toolName: params.toolName,
    argPatternHash: hashHex(params.argFingerprint),
    category: params.category,
    blockReason: params.blockReason,
    contributedAt: new Date().toISOString(),
  };
  return JSON.stringify(record);
}

export interface CertSubmitPayload {
  serverName: string;
  packageName: string;
  version: string;
  level: string;
  attestationJws: string;
}

/** POST certification attestation to Guardian cloud registry (or custom URL). */
export async function submitCertificationAttestation(
  payload: CertSubmitPayload,
  registryUrl = process.env.GUARDIAN_CERT_REGISTRY_URL ?? 'https://guardian.mcp-guardian.cloud/api/v1/certifications',
  apiKey?: string,
): Promise<{ ok: boolean; status: number; body?: unknown }> {
  const res = await fetch(registryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { ok: res.ok, status: res.status, body };
}

function hashHex(input: string): string {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    // Browser / modern Node — sync fallback for SDK simplicity
  }
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(16, '0');
}
