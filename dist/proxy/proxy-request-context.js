/**
 * Per-request state for stdio proxy — keyed by JSON-RPC id (concurrent tools/call safe).
 */
import { captureEphemeralSecrets, runWithEphemeralCredentialVault, } from '../security/ephemeral-credential-vault.js';
import { releaseReservedSpend } from '../services/unified-spend-pool.js';
export function proxyContextTtlMs(defaultTimeoutMs) {
    const raw = process.env['MASTYF_AI_PROXY_CONTEXT_TTL_MS'];
    if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    return Math.max(defaultTimeoutMs * 2, defaultTimeoutMs + 5_000);
}
/** Release unified spend pool reservation without awaiting (best-effort). */
export function releaseSpendReservation(ctx) {
    const id = ctx?.spendReservationId;
    if (!id)
        return;
    ctx.spendReservationId = undefined;
    void releaseReservedSpend(id);
}
export class ProxyRequestContextStore {
    pending = new Map();
    timers = new Map();
    set(id, ctx) {
        this.pending.set(id, ctx);
    }
    get(id) {
        return this.pending.get(id);
    }
    delete(id, releaseSpend = true) {
        this.clearTimeout(id);
        const ctx = this.pending.get(id);
        if (ctx) {
            this.pending.delete(id);
            if (releaseSpend)
                releaseSpendReservation(ctx);
        }
        return ctx;
    }
    clear(releaseSpend = true) {
        for (const id of [...this.pending.keys()]) {
            this.delete(id, releaseSpend);
        }
    }
    get size() {
        return this.pending.size;
    }
    armTimeout(id, ms, onExpire) {
        this.clearTimeout(id);
        const timer = setTimeout(() => {
            this.timers.delete(id);
            const ctx = this.pending.get(id);
            if (ctx)
                onExpire(id, ctx);
        }, ms);
        if (typeof timer.unref === 'function')
            timer.unref();
        this.timers.set(id, timer);
    }
    clearTimeout(id) {
        const t = this.timers.get(id);
        if (t) {
            clearTimeout(t);
            this.timers.delete(id);
        }
    }
    clearAllTimeouts() {
        for (const id of [...this.timers.keys()]) {
            this.clearTimeout(id);
        }
    }
    evictExpired(maxAgeMs, onExpire) {
        const now = Date.now();
        let evicted = 0;
        for (const [id, ctx] of [...this.pending.entries()]) {
            const age = now - (ctx.createdAt ?? ctx.requestStartTime);
            if (age > maxAgeMs) {
                onExpire(id, ctx);
                evicted++;
            }
        }
        return evicted;
    }
    drain(onEach) {
        for (const [id, ctx] of [...this.pending.entries()]) {
            onEach(id, ctx);
        }
    }
    ids() {
        return [...this.pending.keys()];
    }
}
/** Capture provider-shaped secrets from request body/headers for log redaction (in-flight only). */
export function captureRequestSecrets(body, headers) {
    if (body)
        captureEphemeralSecrets(body);
    if (!headers)
        return;
    const auth = headers['authorization'];
    const authVal = Array.isArray(auth) ? auth.join(' ') : auth;
    if (authVal)
        captureEphemeralSecrets(authVal);
    const apiKey = headers['x-api-key'];
    const keyVal = Array.isArray(apiKey) ? apiKey.join(' ') : apiKey;
    if (keyVal)
        captureEphemeralSecrets(keyVal);
}
/** Scope ephemeral credential vault to a single proxy request lifecycle. */
export function withProxyRequestVault(body, headers, fn) {
    return runWithEphemeralCredentialVault(() => {
        captureRequestSecrets(body, headers);
        return fn();
    });
}
//# sourceMappingURL=proxy-request-context.js.map