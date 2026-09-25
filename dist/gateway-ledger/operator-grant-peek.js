/**
 * Peek unused operator allow grants without consuming them.
 * Consume stays on Python /v1/decide. Fail-closed: missing/corrupt file → no bypass.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const ALLOW_GRANT_SCOPES = new Set(['once', 'session', 'similar', 'destination', 'tool']);
export const DENY_GRANT_SCOPES = new Set(['block', 'quarantine', 'permanent_block']);
export function resolveMastyfHome(home = process.env.MASTYF_HOME) {
    return (home && home.trim()) || join(homedir(), '.mastyf');
}
export function loadOperatorGrants(home) {
    const path = join(resolveMastyfHome(home), 'operator_grants.jsonl');
    if (!existsSync(path))
        return [];
    try {
        return readFileSync(path, 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .flatMap((line) => {
            try {
                const row = JSON.parse(line);
                return row?.grant_id && row.tool_name ? [row] : [];
            }
            catch {
                return [];
            }
        });
    }
    catch {
        return [];
    }
}
export function grantMatchesCall(grant, call) {
    const scope = grant.scope || 'once';
    if (DENY_GRANT_SCOPES.has(scope))
        return false;
    if (!ALLOW_GRANT_SCOPES.has(scope))
        return false;
    if (scope === 'tool')
        return grant.tool_name === call.toolName || grant.tool_name === '*';
    if (scope === 'destination') {
        if (!grant.destination || !call.destination)
            return false;
        const gl = grant.destination.toLowerCase();
        const dl = call.destination.toLowerCase();
        return gl.includes(dl) || dl.includes(gl);
    }
    if (scope === 'session') {
        if (!grant.session_id || !call.sessionId || grant.session_id !== call.sessionId)
            return false;
        return grant.tool_name === '*' || grant.tool_name === call.toolName;
    }
    if (grant.tool_name !== '*' && grant.tool_name !== call.toolName)
        return false;
    if (grant.server_id && call.serverId && grant.server_id !== call.serverId)
        return false;
    if (grant.server_name && call.serverName && grant.server_name !== call.serverName)
        return false;
    return true;
}
/** Persist shadow may skip only when an unused matching allow grant exists. */
export function shouldBypassPersistShadow(call, opts) {
    return peekMatchingAllowGrant(call, opts) != null;
}
export function peekMatchingAllowGrant(call, opts) {
    const now = opts?.now ?? Date.now() / 1000;
    const grants = opts?.grants ?? loadOperatorGrants(opts?.home);
    for (const g of grants) {
        if ((g.remaining_uses ?? 0) <= 0)
            continue;
        if (g.expires_at == null || g.expires_at <= now)
            continue;
        if (!grantMatchesCall(g, call))
            continue;
        return g;
    }
    return null;
}
//# sourceMappingURL=operator-grant-peek.js.map