/**
 * HTTP client for MTX threat mesh relay (publish + pull).
 */
import { Logger } from '../../utils/logger.js';
import type { ThreatSignature } from './mesh-node.js';

export interface MeshRelayConfig {
  relayUrl: string;
  apiKey?: string;
  tenantId?: string;
  timeoutMs?: number;
}

export interface MtxRelayRecord {
  signatureHash: string;
  mtxJson: string;
  category: string;
  severity: string;
  verified: boolean;
  reportCount?: number;
}

export class MeshRelayClient {
  private connected = false;
  private lastSyncAt: string | null = null;

  constructor(private readonly config: MeshRelayConfig) {}

  isConnected(): boolean {
    return this.connected;
  }

  getLastSyncAt(): string | null {
    return this.lastSyncAt;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      h['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    if (this.config.tenantId) {
      h['X-Guardian-Tenant'] = this.config.tenantId;
    }
    return h;
  }

  async publish(records: MtxRelayRecord[]): Promise<{ ok: boolean; published: number; error?: string }> {
    if (records.length === 0) return { ok: true, published: 0 };
    const base = this.config.relayUrl.replace(/\/$/, '');
    const url = `${base}/api/v1/mtx/contribute`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ records }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.connected = false;
        return { ok: false, published: 0, error: `relay ${res.status}: ${text.slice(0, 200)}` };
      }
      this.connected = true;
      this.lastSyncAt = new Date().toISOString();
      return { ok: true, published: records.length };
    } catch (err: unknown) {
      this.connected = false;
      const msg = err instanceof Error ? err.message : String(err);
      Logger.debug(`[MeshRelay] publish failed: ${msg}`);
      return { ok: false, published: 0, error: msg };
    }
  }

  async pullCatalog(limit = 500): Promise<{ ok: boolean; signatures: ThreatSignature[]; error?: string }> {
    const base = this.config.relayUrl.replace(/\/$/, '');
    const url = `${base}/api/v1/mtx/catalog?limit=${limit}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
      if (!res.ok) {
        this.connected = false;
        return { ok: false, signatures: [], error: `relay ${res.status}` };
      }
      const body = (await res.json()) as {
        records?: Array<{
          signatureHash?: string;
          mtxJson?: string;
          category?: string;
          severity?: string;
          verified?: boolean;
          reportCount?: number;
          firstSeen?: string;
        }>;
      };
      const signatures: ThreatSignature[] = (body.records ?? []).map((r) => ({
        signatureHash: String(r.signatureHash ?? ''),
        category: String(r.category ?? 'unknown'),
        severity: (r.severity ?? 'medium') as ThreatSignature['severity'],
        firstSeen: r.firstSeen ?? new Date().toISOString(),
        reportCount: r.reportCount ?? 1,
        verified: Boolean(r.verified),
        metadata: r.mtxJson ? { mtxJson: r.mtxJson } : undefined,
      }));
      this.connected = true;
      this.lastSyncAt = new Date().toISOString();
      return { ok: true, signatures: signatures.filter((s) => s.signatureHash.length > 0) };
    } catch (err: unknown) {
      this.connected = false;
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, signatures: [], error: msg };
    }
  }
}
