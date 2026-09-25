/**
 * OWASP MCP03 rug-pull detection — canonical tools/list fingerprinting.
 */
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import * as Metrics from '../utils/metrics.js';
import { persistRugPullEvent } from '../audit/rug-pull-store.js';
export function canonicalizeToolsList(tools) {
    const canonical = JSON.stringify(tools
        .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
    }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))));
    return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
export function hashToolsFromResult(result) {
    if (!result || typeof result !== 'object')
        return null;
    const tools = result.tools;
    if (!Array.isArray(tools) || tools.length === 0)
        return null;
    return canonicalizeToolsList(tools);
}
/**
 * Update fingerprint from a tools/list payload (JSON-RPC response or notification).
 * Returns true if a new rug-pull mismatch was detected this call.
 */
/** Persist last tools/list (with inputSchema) for AI Access / discovery — not invented. */
export function persistToolManifest(serverName, tools) {
    const safe = serverName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'server';
    const dir = join(homedir(), '.mastyf', 'tool-manifests');
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${safe}.json`), JSON.stringify({
            server_name: serverName,
            updated_at: new Date().toISOString(),
            tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema ?? {},
            })),
        }, null, 2), { encoding: 'utf8', mode: 0o600 });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.debug(`[tool-manifest] Failed to persist ${serverName}: ${msg}`);
    }
}
/** Persist last resources/list for AI Access — never invent URIs. */
export function persistResourceManifest(serverName, resources) {
    const safe = serverName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'server';
    const dir = join(homedir(), '.mastyf', 'resource-manifests');
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${safe}.json`), JSON.stringify({
            server_name: serverName,
            updated_at: new Date().toISOString(),
            resources: resources.map((r) => ({
                uri: r.uri,
                name: r.name,
                description: r.description,
                mimeType: r.mimeType,
            })),
        }, null, 2), { encoding: 'utf8', mode: 0o600 });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.debug(`[resource-manifest] Failed to persist ${serverName}: ${msg}`);
    }
}
export function applyToolFingerprint(state, tools, ctx) {
    if (!tools.length)
        return false;
    const hash = canonicalizeToolsList(tools);
    const prefix = ctx.logPrefix ?? `[proxy:${ctx.serverName}]`;
    if (!ctx.quiet) {
        persistToolManifest(ctx.serverName, tools);
    }
    if (!state.fingerprint) {
        state.fingerprint = hash;
        if (!ctx.quiet) {
            Logger.debug(`${prefix} Tool fingerprint registered: ${hash} (${tools.length} tools)`);
        }
        return false;
    }
    if (state.fingerprint === hash)
        return false;
    const prev = state.fingerprint;
    state.blocked = true;
    if (!ctx.quiet) {
        const alert = `${prefix} RUG-PULL DETECTED (OWASP MCP03): tool definitions changed mid-session. Previous: ${prev}, New: ${hash}`;
        Logger.error(alert);
        StructuredLogger.info({
            event: 'rug_pull_detected',
            serverName: ctx.serverName,
            previousFingerprint: prev,
            currentFingerprint: hash,
            toolCount: tools.length,
        });
        Metrics.rugpullDetectedTotal.inc(Metrics.withTenantMetricLabels({ server_name: ctx.serverName }, ctx.tenantId));
        Metrics.recordProxyBlock({
            server_name: ctx.serverName,
            block_reason: 'rug_pull',
            rule: 'tool-fingerprint-mismatch',
            tenant_id: ctx.tenantId,
        }, 'rug_pull');
        persistRugPullEvent({
            serverName: ctx.serverName,
            tenantId: ctx.tenantId,
            previousFingerprint: prev,
            currentFingerprint: hash,
            toolCount: tools.length,
        });
    }
    void ctx.onMismatch?.({
        serverName: ctx.serverName,
        tenantId: ctx.tenantId,
        previousFingerprint: prev,
        currentFingerprint: hash,
        toolCount: tools.length,
    });
    return true;
}
export function applyToolFingerprintFromResult(state, result, ctx) {
    if (!result || typeof result !== 'object')
        return false;
    const tools = result.tools;
    if (!Array.isArray(tools) || tools.length === 0)
        return false;
    return applyToolFingerprint(state, tools, ctx);
}
//# sourceMappingURL=tool-fingerprint.js.map