/**
 * HTTP client for MTX threat mesh relay (publish + pull).
 */
import { Logger } from '../../utils/logger.js';
export class MeshRelayClient {
    config;
    connected = false;
    lastSyncAt = null;
    constructor(config) {
        this.config = config;
    }
    isConnected() {
        return this.connected;
    }
    getLastSyncAt() {
        return this.lastSyncAt;
    }
    headers() {
        const h = { 'Content-Type': 'application/json' };
        if (this.config.apiKey) {
            h['Authorization'] = `Bearer ${this.config.apiKey}`;
        }
        if (this.config.tenantId) {
            h['X-Mastyf-Ai-Tenant'] = this.config.tenantId;
        }
        return h;
    }
    async publish(records) {
        if (records.length === 0)
            return { ok: true, published: 0 };
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
        }
        catch (err) {
            this.connected = false;
            const msg = err instanceof Error ? err.message : String(err);
            Logger.debug(`[MeshRelay] publish failed: ${msg}`);
            return { ok: false, published: 0, error: msg };
        }
    }
    async pullCatalog(limit = 500) {
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
            const body = (await res.json());
            const signatures = (body.records ?? []).map((r) => ({
                signatureHash: String(r.signatureHash ?? ''),
                category: String(r.category ?? 'unknown'),
                severity: (r.severity ?? 'medium'),
                firstSeen: r.firstSeen ?? new Date().toISOString(),
                reportCount: r.reportCount ?? 1,
                verified: Boolean(r.verified),
                metadata: r.mtxJson ? { mtxJson: r.mtxJson } : undefined,
            }));
            this.connected = true;
            this.lastSyncAt = new Date().toISOString();
            return { ok: true, signatures: signatures.filter((s) => s.signatureHash.length > 0) };
        }
        catch (err) {
            this.connected = false;
            const msg = err instanceof Error ? err.message : String(err);
            return { ok: false, signatures: [], error: msg };
        }
    }
}
//# sourceMappingURL=mesh-relay-client.js.map