/**
 * Mastyf Security Gateway API Routes for mastyf.ai
 *
 * Exposes /api/gateway/* endpoints on the dashboard server.
 * Security Invariants:
 * 1. Token Isolation: Reads ~/.mastyf/control_token on backend; never sends token to browser.
 * 2. Explicit Confirmation: Mutating actions (apply, rollback, activate) mandate { confirmation: true }
 *    in the payload. Only the backend sets X-Mastyf-Authorization: confirmed to Gateway.
 * 3. Authoritative Truth: Gateway errors yield structured GATEWAY_STATE_UNAVAILABLE errors.
 */
import { MastyfGatewayClient, GatewayUnavailableError, GatewayVersionMismatchError, GatewayError, } from '../clients/gateway-client.js';
import { decideLatencyMs, observePerimeterSloGauges } from '../utils/metrics.js';
import { LOCAL_OBS_GRAFANA_TRACE_URL } from './grafana-trace.js';
import { isHarnessReceiptId } from './perimeter-honesty.js';
let gatewayClientInstance = null;
export function getGatewayClient() {
    if (!gatewayClientInstance) {
        gatewayClientInstance = new MastyfGatewayClient();
    }
    return gatewayClientInstance;
}
export function setGatewayClient(client) {
    gatewayClientInstance = client;
}
/** Load tools from ~/.mastyf/tool-manifests/{server}.json when discovery tools[] is empty. */
async function enrichServersFromManifests(servers) {
    let enriched = 0;
    try {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const manifestDir = path.join(os.homedir(), '.mastyf', 'tool-manifests');
        const resourceDir = path.join(os.homedir(), '.mastyf', 'resource-manifests');
        const loadManifestFile = (file) => {
            if (!fs.existsSync(file))
                return null;
            try {
                return JSON.parse(fs.readFileSync(file, 'utf8'));
            }
            catch {
                return null;
            }
        };
        const candidatesFor = (name) => {
            const raw = String(name || 'server');
            const base = raw
                .replace(/^official-/, '')
                .replace(/^prod-/, '')
                .replace(/-proxy$/, '')
                .replace(/^my-/, '');
            return [...new Set([raw, base, 'filesystem'].filter((c) => {
                    if (c === 'filesystem') {
                        return /filesystem/i.test(raw);
                    }
                    return Boolean(c);
                }))];
        };
        const mapTool = (t) => ({
            name: String(t.name),
            description: String(t.description || ''),
            security_class: String(t.security_class || 'UNKNOWN'),
            input_schema: t.inputSchema ||
                t.input_schema ||
                {},
            inputSchema: t.inputSchema ||
                t.input_schema ||
                {},
        });
        const mapResource = (r) => ({
            uri: String(r.uri || r.name || ''),
            name: String(r.name || r.uri || ''),
            description: String(r.description || ''),
            mimeType: r.mimeType != null ? String(r.mimeType) : undefined,
        });
        for (const s of servers) {
            const name = String(s.name || '');
            let loadedTools = null;
            let loadedResources = null;
            for (const cand of candidatesFor(name)) {
                const safe = String(cand).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
                const toolFile = path.join(manifestDir, `${safe}.json`);
                const raw = loadManifestFile(toolFile);
                if (raw?.tools && Array.isArray(raw.tools) && raw.tools.length > 0 && !loadedTools) {
                    loadedTools = raw.tools;
                }
                if (raw?.resources && Array.isArray(raw.resources) && raw.resources.length > 0 && !loadedResources) {
                    loadedResources = raw.resources;
                }
                const resFile = path.join(resourceDir, `${safe}.json`);
                const resRaw = loadManifestFile(resFile);
                if (resRaw?.resources && Array.isArray(resRaw.resources) && resRaw.resources.length > 0) {
                    loadedResources = resRaw.resources;
                }
                if (loadedTools && loadedResources)
                    break;
            }
            const existingTools = Array.isArray(s.tools) ? s.tools : [];
            if (loadedTools && existingTools.length === 0) {
                s.tools = loadedTools.filter((t) => typeof t.name === 'string').map(mapTool);
                enriched += 1;
            }
            else if (loadedTools && existingTools.length > 0) {
                // Merge live inputSchema onto discovery tools that lack schema (Inspector pattern).
                const byName = new Map();
                for (const t of loadedTools) {
                    if (typeof t.name === 'string')
                        byName.set(t.name, t);
                }
                let merged = 0;
                s.tools = existingTools.map((t) => {
                    const nameKey = String(t.name || '');
                    const fromManifest = byName.get(nameKey);
                    if (!fromManifest)
                        return t;
                    const hasSchema = (t.inputSchema && Object.keys(t.inputSchema).length > 0) ||
                        (t.input_schema && Object.keys(t.input_schema).length > 0);
                    if (hasSchema)
                        return t;
                    const schema = fromManifest.inputSchema ||
                        fromManifest.input_schema ||
                        {};
                    if (!schema || Object.keys(schema).length === 0)
                        return t;
                    merged += 1;
                    return {
                        ...t,
                        description: t.description || fromManifest.description || '',
                        input_schema: schema,
                        inputSchema: schema,
                    };
                });
                if (merged > 0)
                    enriched += 1;
            }
            if (loadedResources && (!Array.isArray(s.resources) || s.resources.length === 0)) {
                s.resources = loadedResources
                    .filter((r) => r.uri || r.name)
                    .map(mapResource)
                    .filter((r) => r.uri || r.name);
                if (s.resources.length > 0)
                    s.resources_status = 'from_manifest';
            }
            else if (!Array.isArray(s.resources) || s.resources.length === 0) {
                s.resources = [];
                s.resources_status = 'unavailable';
            }
        }
    }
    catch {
        /* optional */
    }
    return enriched;
}
export async function handleGatewayApiRoutes(params) {
    const { url, method, req, res, writeJson, readBody, setCors } = params;
    if (!url.startsWith('/api/gateway')) {
        return false;
    }
    setCors();
    const client = getGatewayClient();
    const parsedUrl = new URL(url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    try {
        // ── GET /api/gateway/status ────────────────────────────────────────────────
        if (pathname === '/api/gateway/status' && method === 'GET') {
            try {
                const status = await client.status();
                let serversCount = status.servers_count ?? 0;
                try {
                    const { discoverAllServers } = await import('../fleet/unified-server-registry.js');
                    const unified = discoverAllServers();
                    if (Array.isArray(unified) && unified.length > 0) {
                        serversCount = Math.max(serversCount, unified.length);
                    }
                }
                catch {
                    /* fallback */
                }
                const ledger = status.ledger;
                const verification = status.verification;
                observePerimeterSloGauges({
                    chainOk: ledger?.chain_integrity,
                    escalated: ledger?.escalated,
                    selfTestUnixSec: verification?.last_verified_at,
                });
                writeJson(res, 200, { available: true, ...status, servers_count: serversCount });
            }
            catch (err) {
                const isUnavailable = err instanceof GatewayUnavailableError ||
                    err instanceof GatewayVersionMismatchError ||
                    (typeof err === 'object' &&
                        err !== null &&
                        (('name' in err &&
                            (err.name === 'GatewayUnavailableError' ||
                                err.name === 'GatewayVersionMismatchError')) ||
                            ('code' in err &&
                                (err.code === 'GATEWAY_UNAVAILABLE' ||
                                    err.code === 'GATEWAY_VERSION_MISMATCH' ||
                                    err.code === 'TOKEN_MISSING'))));
                if (isUnavailable) {
                    const errObj = err;
                    writeJson(res, 200, {
                        available: false,
                        code: errObj.code || 'GATEWAY_UNAVAILABLE',
                        message: errObj.message || 'Gateway unavailable',
                        environment_state: 'UNKNOWN',
                        intelligence: {
                            tier: 'unknown',
                            name: 'none',
                            guard_pro_active: false,
                            entitlement: 'N/A',
                            fallback_active: false,
                            fallback_reason: null,
                        },
                    });
                    return true;
                }
                throw err;
            }
            return true;
        }
        // ── GET /api/gateway/protection ────────────────────────────────────────────
        if (pathname === '/api/gateway/protection' && method === 'GET') {
            const protection = await client.protection();
            let totalServers = null;
            try {
                const { discoverAllServers } = await import('../fleet/unified-server-registry.js');
                const unified = discoverAllServers();
                if (Array.isArray(unified) && unified.length > 0) {
                    totalServers = unified.length;
                }
            }
            catch {
                /* registry unavailable — do not invent a count */
            }
            if (totalServers == null) {
                const fromProtection = typeof protection?.total_servers === 'number'
                    ? protection.total_servers
                    : null;
                totalServers = fromProtection;
            }
            if (totalServers == null && typeof protection?.servers_count === 'number') {
                totalServers = protection.servers_count;
            }
            const unmediated = protection?.unmediated_count ?? protection?.total_unmediated ?? null;
            const payload = { ...protection };
            if (typeof totalServers === 'number') {
                payload.total_servers = totalServers;
                if (typeof unmediated === 'number') {
                    payload.total_mediated = Math.max(0, totalServers - unmediated);
                }
            }
            writeJson(res, 200, payload);
            return true;
        }
        // ── GET /api/gateway/servers ───────────────────────────────────────────────
        if (pathname === '/api/gateway/servers' && method === 'GET') {
            let clientServers = [];
            try {
                const res = await client.servers();
                if (Array.isArray(res))
                    clientServers = res;
            }
            catch {
                clientServers = [];
            }
            const serverMap = new Map();
            for (const s of clientServers) {
                if (s && s.name) {
                    serverMap.set(s.name, { ...s });
                }
            }
            try {
                const { discoverAllServers } = await import('../fleet/unified-server-registry.js');
                const unified = discoverAllServers();
                if (Array.isArray(unified)) {
                    for (const u of unified) {
                        if (!serverMap.has(u.name)) {
                            const cmd = u.config?.command ||
                                (u.localUrl || u.config?.url ? 'mcp-remote' : null);
                            const args = u.config?.args ||
                                (u.localUrl ? [u.localUrl] : u.config?.url ? [u.config.url] : []);
                            serverMap.set(u.name, {
                                name: u.name,
                                client: u.source || 'unknown',
                                command: cmd || 'unknown',
                                args: Array.isArray(args) ? args : [],
                                tools_count: 0,
                                tools: [],
                                transport: u.transport || 'unknown',
                                source: u.source || 'unknown',
                                status: u.status || 'unknown',
                            });
                        }
                        else {
                            const existing = serverMap.get(u.name);
                            existing.transport = existing.transport || u.transport || 'unknown';
                            existing.status = existing.status || u.status || 'unknown';
                        }
                    }
                }
            }
            catch {
                /* skip unified merge */
            }
            const servers = Array.from(serverMap.values());
            // Honesty: never invent tools when introspection has not returned tools[]
            // Enrich empty tools from Node-persisted tools/list manifests when present.
            await enrichServersFromManifests(servers);
            servers.forEach((s) => {
                if (!Array.isArray(s.tools))
                    s.tools = [];
                s.tools_count = s.tools.length;
                if (s.tools.length === 0) {
                    s.tools_status = 'introspection_pending';
                }
                else {
                    delete s.tools_status;
                }
                // Never leak machine-specific operator paths into discovered args
                if (Array.isArray(s.args)) {
                    s.args = s.args.map((a) => typeof a === 'string' && a.includes('/Users/') && a.includes('.mastyf')
                        ? '~/.mastyf/active_policy.yaml'
                        : a);
                }
            });
            writeJson(res, 200, servers);
            return true;
        }
        // ── POST /api/gateway/servers/reintrospect ─────────────────────────────────
        // Re-read ~/.mastyf/tool-manifests and return refreshed server inventory.
        if (pathname === '/api/gateway/servers/reintrospect' && method === 'POST') {
            let clientServers = [];
            try {
                const resServers = await client.servers();
                if (Array.isArray(resServers))
                    clientServers = resServers;
            }
            catch {
                clientServers = [];
            }
            const serverMap = new Map();
            for (const s of clientServers) {
                if (s && s.name)
                    serverMap.set(s.name, { ...s });
            }
            try {
                const { discoverAllServers } = await import('../fleet/unified-server-registry.js');
                const unified = discoverAllServers();
                if (Array.isArray(unified)) {
                    for (const u of unified) {
                        if (!serverMap.has(u.name)) {
                            serverMap.set(u.name, {
                                name: u.name,
                                client: u.source === 'ide' ? 'Cursor' : 'Mastyf Fleet',
                                command: 'mastyf',
                                args: [],
                                tools_count: 0,
                                tools: [],
                                transport: u.transport,
                                source: u.source,
                                status: u.status || 'running',
                            });
                        }
                        else {
                            const existing = serverMap.get(u.name);
                            existing.transport = existing.transport || u.transport;
                            existing.status = existing.status || u.status || 'running';
                        }
                    }
                }
            }
            catch {
                /* skip */
            }
            const servers = Array.from(serverMap.values());
            const enriched = await enrichServersFromManifests(servers);
            servers.forEach((s) => {
                if (!Array.isArray(s.tools))
                    s.tools = [];
                s.tools_count = s.tools.length;
                if (s.tools.length === 0)
                    s.tools_status = 'introspection_pending';
                else
                    delete s.tools_status;
            });
            writeJson(res, 200, {
                ok: true,
                enriched_from_manifest: enriched,
                servers,
            });
            return true;
        }
        // ── GET /api/gateway/servers/stats ─────────────────────────────────────────
        if (pathname === '/api/gateway/servers/stats' && method === 'GET') {
            try {
                const stats = await client.serverStats();
                writeJson(res, 200, stats);
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, 200, { total_servers: 0, servers: [], available: false, message: err.message });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/servers/:id/receipts|posture ──────────────────────────
        {
            const serverRoute = pathname.match(/^\/api\/gateway\/servers\/([^/]+)\/(receipts|posture)$/);
            if (serverRoute && method === 'GET') {
                const serverId = decodeURIComponent(serverRoute[1]);
                const kind = serverRoute[2];
                if (kind === 'receipts') {
                    const limit = Number(parsedUrl.searchParams.get('limit')) || 50;
                    const offset = parsedUrl.searchParams.has('offset')
                        ? Number(parsedUrl.searchParams.get('offset'))
                        : 0;
                    const page = await client.serverReceipts(serverId, { limit, offset });
                    if (Array.isArray(page?.receipts)) {
                        page.receipts = page.receipts.map((r, idx) => ({
                            ...r,
                            receipt_id: r.receipt_id ||
                                r.request_id ||
                                (r.sequence_id != null ? `rcpt-${r.sequence_id}` : null) ||
                                r.receipt_hash ||
                                `rcpt-${idx}`,
                            decision: r.decision || r.arbiter_decision || 'ALLOW',
                            timestamp: r.timestamp_utc || r.timestamp || new Date().toISOString(),
                            caller_agent: r.caller_agent || r.principal_id || 'AI Client',
                            payload_sha256: r.payload_sha256 || r.receipt_hash || '',
                            server_id: r.server_id || serverId,
                            server_name: r.server_name || serverId,
                        }));
                    }
                    writeJson(res, 200, page);
                }
                else {
                    const posture = await client.serverPosture(serverId);
                    writeJson(res, 200, posture);
                }
                return true;
            }
        }
        // ── GET /api/gateway/policy ────────────────────────────────────────────────
        if (pathname === '/api/gateway/policy' && method === 'GET') {
            const policy = await client.policy();
            // Enrich with on-disk active policy YAML when control plane omits it
            try {
                const fs = await import('fs');
                const path = await import('path');
                const os = await import('os');
                const yamlPath = path.join(os.homedir(), '.mastyf', 'active_policy.yaml');
                if (fs.existsSync(yamlPath)) {
                    const yaml = fs.readFileSync(yamlPath, 'utf8');
                    if (yaml.trim()) {
                        policy.policy_yaml = yaml;
                        policy.policy_yaml_source = '~/.mastyf/active_policy.yaml';
                    }
                }
            }
            catch {
                /* optional */
            }
            writeJson(res, 200, policy);
            return true;
        }
        // ── GET /api/gateway/receipts ──────────────────────────────────────────────
        if (pathname === '/api/gateway/receipts' && method === 'GET') {
            const limit = Number(parsedUrl.searchParams.get('limit')) || 50;
            const offset = parsedUrl.searchParams.has('offset') ? Number(parsedUrl.searchParams.get('offset')) : undefined;
            const cursor = parsedUrl.searchParams.get('cursor') || undefined;
            const serverId = parsedUrl.searchParams.get('server_id') || parsedUrl.searchParams.get('server') || undefined;
            const serverName = parsedUrl.searchParams.get('server_name') || undefined;
            const receiptsPage = await client.receipts({ limit, cursor, offset, serverId, serverName });
            if (Array.isArray(receiptsPage?.receipts)) {
                receiptsPage.receipts = receiptsPage.receipts.map((r, idx) => ({
                    ...r,
                    receipt_id: r.receipt_id ||
                        r.request_id ||
                        (r.sequence_id != null ? `rcpt-${r.sequence_id}` : null) ||
                        r.receipt_hash ||
                        `rcpt-${idx}`,
                    decision: r.decision || r.arbiter_decision || null,
                    timestamp: r.timestamp_utc || r.timestamp || null,
                    caller_agent: r.caller_agent || r.principal_id || null,
                    payload_sha256: r.payload_sha256 || r.receipt_hash || null,
                    server_id: r.server_id || r.server_name || null,
                    server_name: r.server_name || r.server_id || null,
                }));
            }
            writeJson(res, 200, receiptsPage);
            return true;
        }
        // ── GET /api/gateway/receipts/stats ────────────────────────────────────────
        // Time-window aggregates. Prefer BFF page aggregate so UI never hard-fails when
        // Gateway lacks /v1/receipts/stats (old process treats "stats" as receipt id).
        // Also accept /api/gateway/ledger/window-stats (unambiguous — never collides with receipts/:id).
        if ((pathname === '/api/gateway/receipts/stats' ||
            pathname === '/api/gateway/ledger/window-stats') &&
            method === 'GET') {
            const windowParam = parsedUrl.searchParams.get('window') || '24h';
            const since = parsedUrl.searchParams.get('since') || undefined;
            const until = parsedUrl.searchParams.get('until') || undefined;
            const aggregateFromPage = async (gatewayError) => {
                const page = await client.receipts({ limit: 500 }).catch(() => ({ receipts: [] }));
                const list = Array.isArray(page?.receipts) ? page.receipts : [];
                const now = Date.now();
                const msMap = {
                    '1h': 3600_000,
                    '24h': 86400_000,
                    '7d': 7 * 86400_000,
                    all: null,
                    lifetime: null,
                };
                const span = msMap[windowParam] ?? msMap['24h'];
                const sinceMs = since ? Date.parse(since) : span != null ? now - span : null;
                const untilMs = until ? Date.parse(until) : now;
                let allowed = 0;
                let blocked = 0;
                let escalated = 0;
                let other = 0;
                let inWindow = 0;
                let harnessExcluded = 0;
                for (const r of list) {
                    const ts = Date.parse(String(r.timestamp_utc || r.timestamp || ''));
                    if (!Number.isFinite(ts))
                        continue;
                    if (sinceMs != null && ts < sinceMs)
                        continue;
                    if (Number.isFinite(untilMs) && ts > untilMs)
                        continue;
                    const rid = String(r.request_id || r.receipt_id || '');
                    if (isHarnessReceiptId(rid)) {
                        harnessExcluded += 1;
                        continue;
                    }
                    inWindow += 1;
                    const d = r.decision || r.arbiter_decision;
                    if (d === 'ALLOW')
                        allowed += 1;
                    else if (d === 'BLOCK')
                        blocked += 1;
                    else if (d === 'ESCALATE')
                        escalated += 1;
                    else
                        other += 1;
                }
                return {
                    source: gatewayError ? 'bff-receipts-page-fallback' : 'bff-receipts-page',
                    assembled_by: 'bff-receipts-stats',
                    window: windowParam,
                    since: since || (sinceMs != null ? new Date(sinceMs).toISOString() : null),
                    until: until || new Date(untilMs).toISOString(),
                    scanned_receipts: list.length,
                    harness_excluded: harnessExcluded,
                    in_window: inWindow,
                    allowed,
                    blocked,
                    escalated,
                    other,
                    zero_byte_enforcements: blocked + escalated,
                    note: gatewayError
                        ? 'Gateway /v1/receipts/stats unavailable — aggregated from loaded receipts page (may undercount).'
                        : 'Aggregated from loaded receipts page (live ledger subset).',
                    ...(gatewayError ? { gateway_error: gatewayError } : {}),
                };
            };
            // Try native gateway stats first; never surface receipt-id 404 to the client.
            try {
                const stats = await client.receiptStats({ window: windowParam, since, until });
                writeJson(res, 200, {
                    ...stats,
                    assembled_by: 'gateway-receipts-stats',
                    source: stats.source || 'live-ledger',
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                writeJson(res, 200, await aggregateFromPage(msg));
            }
            return true;
        }
        // ── GET /api/gateway/siem-status ───────────────────────────────────────────
        // Read-only exporter config posture — never invents connector health scores.
        if (pathname === '/api/gateway/siem-status' && method === 'GET') {
            const enabled = process.env['MASTYF_AI_SIEM_ENABLED'] === 'true' ||
                process.env['MASTYF_AI_SIEM_EXPORT_ENABLED'] === 'true';
            const protocol = process.env['MASTYF_AI_SIEM_PROTOCOL'] ||
                process.env['MASTYF_AI_SIEM_EXPORT_FORMAT'] ||
                null;
            const endpointConfigured = Boolean(process.env['MASTYF_AI_SIEM_ENDPOINT'] || process.env['MASTYF_AI_SIEM_EXPORT_PATH']);
            writeJson(res, 200, {
                source: 'bff-env',
                enabled,
                protocol: protocol || '—',
                endpoint_configured: endpointConfigured,
                note: enabled
                    ? 'SIEM export enabled via env — Mastyf remains source of truth; SIEM is a sink.'
                    : 'SIEM export not enabled (MASTYF_AI_SIEM_ENABLED / MASTYF_AI_SIEM_EXPORT_ENABLED).',
            });
            return true;
        }
        // ── GET /api/gateway/control-receipts ──────────────────────────────────────
        if (pathname === '/api/gateway/control-receipts' && method === 'GET') {
            const limit = Number(parsedUrl.searchParams.get('limit')) || 50;
            const offset = parsedUrl.searchParams.has('offset') ? Number(parsedUrl.searchParams.get('offset')) : undefined;
            const cursor = parsedUrl.searchParams.get('cursor') || undefined;
            const receipts = await client.controlReceipts({ limit, cursor, offset });
            writeJson(res, 200, receipts);
            return true;
        }
        // ── POST /api/gateway/protection/plan ──────────────────────────────────────
        if (pathname === '/api/gateway/protection/plan' && method === 'POST') {
            const body = await readBody(req);
            const serverNames = Array.isArray(body['serverNames'])
                ? body['serverNames']
                : undefined;
            const plan = await client.protectionPlan({ serverNames });
            writeJson(res, 200, plan);
            return true;
        }
        // ── POST /api/gateway/protection/apply ─────────────────────────────────────
        if (pathname === '/api/gateway/protection/apply' && method === 'POST') {
            const body = await readBody(req);
            if (body['confirmation'] !== true) {
                writeJson(res, 400, {
                    error: 'Explicit confirmation required to apply protection plan',
                    code: 'CONFIRMATION_REQUIRED',
                });
                return true;
            }
            const plan = body['plan'];
            if (!plan || typeof plan !== 'object' || !plan.plan_id) {
                writeJson(res, 400, {
                    error: 'Valid plan object required',
                    code: 'INVALID_PLAN',
                });
                return true;
            }
            const result = await client.protectionApply(plan, true);
            writeJson(res, 200, result);
            return true;
        }
        // ── POST /api/gateway/protection/rollback ──────────────────────────────────
        if (pathname === '/api/gateway/protection/rollback' && method === 'POST') {
            const body = await readBody(req);
            if (body['confirmation'] !== true) {
                writeJson(res, 400, {
                    error: 'Explicit confirmation required for generational rollback',
                    code: 'CONFIRMATION_REQUIRED',
                });
                return true;
            }
            const targetGen = typeof body['targetGeneration'] === 'number'
                ? Number(body['targetGeneration'])
                : undefined;
            const result = await client.rollback(targetGen, true);
            writeJson(res, 200, result);
            return true;
        }
        // ── POST /api/gateway/policy/propose ───────────────────────────────────────
        if (pathname === '/api/gateway/policy/propose' && method === 'POST') {
            const body = await readBody(req);
            const intent = String(body['intent'] || '').trim();
            if (!intent) {
                writeJson(res, 400, { error: 'Intent required for policy proposal' });
                return true;
            }
            const result = await client.policyPropose(intent);
            writeJson(res, 200, result);
            return true;
        }
        // ── POST /api/gateway/policy/activate ──────────────────────────────────────
        if (pathname === '/api/gateway/policy/activate' && method === 'POST') {
            const body = await readBody(req);
            if (body['confirmation'] !== true) {
                writeJson(res, 400, {
                    error: 'Explicit confirmation required to activate policy',
                    code: 'CONFIRMATION_REQUIRED',
                });
                return true;
            }
            const policyYaml = String(body['policyYaml'] || '').trim();
            if (!policyYaml) {
                writeJson(res, 400, { error: 'policyYaml required for policy activation' });
                return true;
            }
            const result = await client.policyActivate(policyYaml, true);
            writeJson(res, 200, result);
            return true;
        }
        // ── POST /api/gateway/explain ──────────────────────────────────────────────
        // ── GET /api/gateway/system/geo-timezone ──────────────────────────────────
        if (pathname === '/api/gateway/system/geo-timezone' && method === 'GET') {
            // Compute correct UTC offset string for any IANA timezone
            const computeUtcOffset = (tz) => {
                try {
                    const parts = new Intl.DateTimeFormat('en-US', {
                        timeZone: tz, timeZoneName: 'shortOffset',
                    }).formatToParts(new Date());
                    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'UTC+0';
                    // "GMT+5:30" -> "UTC+05:30", "GMT-8" -> "UTC-08:00"
                    return tzName.replace('GMT', 'UTC').replace(/UTC([+-])(\d)(?::(\d\d))?$/, (_m, s, h, m) => `UTC${s}0${h}:${m || '00'}`);
                }
                catch {
                    return 'UTC+00:00';
                }
            };
            const computeTzAbbr = (tz) => {
                const abbrs = {
                    'Asia/Kolkata': 'IST', 'Asia/Calcutta': 'IST',
                    'America/New_York': 'ET', 'America/Chicago': 'CT',
                    'America/Denver': 'MT', 'America/Los_Angeles': 'PT',
                    'Europe/London': 'BST', 'Europe/Paris': 'CET', 'Europe/Berlin': 'CET',
                    'Asia/Tokyo': 'JST', 'Asia/Singapore': 'SGT',
                    'Asia/Dubai': 'GST', 'Australia/Sydney': 'AEST', 'UTC': 'UTC',
                };
                if (abbrs[tz])
                    return abbrs[tz];
                try {
                    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date());
                    return parts.find((p) => p.type === 'timeZoneName')?.value || tz;
                }
                catch {
                    return tz;
                }
            };
            const isPrivateIp = (ip) => !ip || ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' ||
                ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.') || ip.startsWith('169.254.');
            const systemTz = (() => {
                const t = Intl.DateTimeFormat().resolvedOptions().timeZone;
                return (t === 'Asia/Calcutta' ? 'Asia/Kolkata' : t) || 'Asia/Kolkata';
            })();
            const systemFallback = {
                ip: 'local', city: '', region: '', country: '', countryCode: 'XX',
                timezone: systemTz,
                timezoneAbbr: computeTzAbbr(systemTz),
                utcOffset: computeUtcOffset(systemTz),
                source: 'system',
            };
            try {
                let rawIp = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '').split(',')[0].trim();
                // For loopback/private: discover server's own public IP
                if (isPrivateIp(rawIp)) {
                    try {
                        const ipifyRes = await fetch('https://api.ipify.org?format=json', {
                            signal: AbortSignal.timeout(3000),
                        });
                        if (ipifyRes.ok) {
                            const ipifyData = await ipifyRes.json();
                            rawIp = ipifyData.ip || rawIp;
                        }
                    }
                    catch { /* keep whatever we have */ }
                }
                const geoRes = await fetch(`https://ipapi.co/${encodeURIComponent(rawIp)}/json/`, {
                    signal: AbortSignal.timeout(5000),
                    headers: { 'User-Agent': 'mastyf-dashboard/1.0' },
                });
                if (!geoRes.ok)
                    throw new Error(`ipapi.co ${geoRes.status}`);
                const geo = await geoRes.json();
                if (!geo || !geo.timezone || geo.error) {
                    writeJson(res, 200, { ...systemFallback, ip: rawIp });
                    return true;
                }
                writeJson(res, 200, {
                    ip: geo.ip || rawIp,
                    city: geo.city || '',
                    region: geo.region || '',
                    country: geo.country_name || '',
                    countryCode: geo.country_code || 'XX',
                    timezone: geo.timezone,
                    timezoneAbbr: computeTzAbbr(geo.timezone),
                    utcOffset: computeUtcOffset(geo.timezone),
                    latitude: geo.latitude,
                    longitude: geo.longitude,
                    org: geo.org || '',
                    source: 'ip-lookup',
                });
            }
            catch {
                writeJson(res, 200, systemFallback);
            }
            return true;
        }
        if (pathname === '/api/gateway/deployment-manifest' && method === 'GET') {
            const manifest = await client.deploymentManifest();
            writeJson(res, 200, manifest);
            return true;
        }
        if (pathname === '/api/gateway/self-test' && method === 'POST') {
            const body = await readBody(req);
            const rawFail = body['force_fail_case_id'];
            const forceFail = typeof rawFail === 'number'
                ? rawFail
                : typeof rawFail === 'string' && /^\d+$/.test(rawFail)
                    ? Number(rawFail)
                    : undefined;
            const report = await client.selfTest(forceFail != null ? { force_fail_case_id: forceFail } : {});
            writeJson(res, 200, report);
            return true;
        }
        if (pathname === '/api/gateway/explain' && method === 'POST') {
            const body = await readBody(req);
            const receiptId = String(body['receiptId'] || '').trim();
            if (!receiptId) {
                writeJson(res, 400, { error: 'receiptId required to explain decision' });
                return true;
            }
            const explanation = await client.explainDecision(receiptId);
            writeJson(res, 200, explanation);
            return true;
        }
        // ── POST /api/gateway/agent-chat ───────────────────────────────────────────
        if (pathname === '/api/gateway/agent-chat' && method === 'POST') {
            const body = await readBody(req);
            const message = String(body['message'] || '').trim();
            const sessionId = body['sessionId'] ? String(body['sessionId']) : undefined;
            const principalId = body['principalId'] ? String(body['principalId']) : undefined;
            const mock = Boolean(body['mock']);
            if (!message) {
                writeJson(res, 400, { error: 'message required' });
                return true;
            }
            try {
                const result = await client.agentChat({ message, sessionId, principalId, mock });
                writeJson(res, 200, result);
            }
            catch (err) {
                writeJson(res, err.statusCode || 500, {
                    error: err.message || 'Agent chat invocation failed',
                    code: err.code || 'AGENT_CHAT_FAILED',
                });
            }
            return true;
        }
        // ── POST /api/gateway/chat ─────────────────────────────────────────────────
        if (pathname === '/api/gateway/chat' && method === 'POST') {
            const body = await readBody(req);
            const question = String(body['question'] || '').trim();
            const history = Array.isArray(body['history']) ? body['history'] : [];
            const evidence = String(body['evidence'] || '').trim();
            const contextEvent = body['contextEvent'];
            if (!question) {
                writeJson(res, 400, { error: 'question required' });
                return true;
            }
            // Fetch live state projection
            let status = null;
            let protection = null;
            let servers = [];
            let receipts = [];
            let isLive = true;
            try {
                const [s, p, srv, rct] = await Promise.allSettled([
                    client.status(),
                    client.protection(),
                    client.servers(),
                    client.receipts({ limit: 20 }),
                ]);
                if (s.status === 'fulfilled')
                    status = s.value;
                if (p.status === 'fulfilled')
                    protection = p.value;
                if (srv.status === 'fulfilled')
                    servers = srv.value;
                if (rct.status === 'fulfilled')
                    receipts = rct.value?.receipts || [];
            }
            catch (err) {
                isLive = false;
            }
            if (!status || !protection) {
                isLive = false;
            }
            const total_servers = protection?.total_servers ?? servers.length ?? 0;
            const total_unmediated = protection?.total_unmediated ?? protection?.unmediated_count ?? 0;
            const total_mediated = protection?.total_mediated ?? Math.max(0, total_servers - total_unmediated);
            const policyId = status?.policy?.id || 'unavailable';
            const policyHash = status?.policy?.hash || 'unavailable';
            const chainRaw = status?.ledger?.chain_integrity;
            const chainIntegrity = chainRaw === true || chainRaw === 'VALID' || chainRaw === 'valid'
                ? 'VALID'
                : chainRaw === false || chainRaw === 'FAILED' || chainRaw === 'COMPROMISED'
                    ? 'FAILED'
                    : chainRaw == null
                        ? 'unavailable'
                        : String(chainRaw);
            const zeroByteBlocks = status?.ledger?.zero_byte_enforcements;
            const totalReceipts = status?.ledger?.total_receipts != null
                ? status.ledger.total_receipts
                : receipts.length > 0
                    ? receipts.length
                    : null;
            // Extract discovered tools overview
            const toolSummaries = [];
            servers.forEach((s) => {
                (s.tools || []).forEach((t) => {
                    toolSummaries.push(`${s.name}.${t.name} [class: ${t.security_class || 'READ'}]`);
                });
            });
            // System Prompt for Mastyf Personalized AI Security Expert
            const systemPrompt = `You are Mastyf, an elite conversational AI security architect and personalized AI security companion for the user's workstation.
You converse elaborately, with deep technical know-how, nuanced explanations, and structured clarity, exactly like ChatGPT does for complex engineering, but specialized in AI agent security, MCP tool mediation, Capability-Based Access Control (CBAC), Decentralized Information Flow Control (DIFC), prompt injection defenses (both direct and indirect), zero-byte physical dispatch, and cryptographic trust provenance.

LIVE RUNTIME GROUNDING FROM USER ENVIRONMENT:
- Enforcement Gateway: ${isLive ? 'ONLINE & MEDIATING' : 'OFFLINE'}
- Environment Security Posture: ${protection?.result || 'UNKNOWN'}
- Total MCP Servers Discovered: ${total_servers} (${total_mediated} mediated by Mastyf, ${total_unmediated} unmediated direct execution)
- Active Policy ID: \`${policyId}\`${policyHash !== 'unavailable' ? ` (SHA-256: \`${String(policyHash).slice(0, 16)}...\`)` : ' (hash unavailable)'}
- Ledger Receipts Recorded: ${totalReceipts == null ? 'unavailable' : totalReceipts.toLocaleString()} (${zeroByteBlocks == null ? 'zero-byte unavailable' : `${zeroByteBlocks} zero-byte physical blocks`})
- Audit Chain Cryptographic Integrity: ${chainIntegrity}
- Discovered MCP Tools: ${toolSummaries.slice(0, 30).join(', ')}${toolSummaries.length > 30 ? ` (+${toolSummaries.length - 30} more)` : ''}
${evidence ? `- Active Trust Graph / ActionTrace Evidence:\n${evidence}` : ''}
${contextEvent ? `- Focus Context Event: Tool \`${contextEvent.toolName}\` by \`${contextEvent.agent}\`, Status: ${contextEvent.status}, Receipt: #${contextEvent.receiptId}` : ''}
${status?.intelligence ? `- Guard runtime: backend=${status.intelligence.aia_backend || '—'} engine=${status.intelligence.aia_engine || '—'} model=${status.intelligence.aia_model || status.intelligence.name || '—'} (advisory, cannot expand authority)` : ''}

CRITICAL OPERATING GUIDELINES:
1. Speak elaborately and conversationally like ChatGPT, explaining the "why", the security principles, the threat vectors, and architectural nuances.
2. Ground explanations in the user's real environment metrics and discovered MCP servers whenever applicable.
3. When answering "Why was this tool allowed?" or "Why was this blocked?", clearly present the evidence chain: Policy, Capability, Principal, Workflow State (CLEAN/TAINTED), DIFC verdict, Arbiter verdict, and Receipt.
4. Guard V6 is an advisory semantic auditor only — it cannot create or expand CBAC/DIFC/Workflow authority. Deterministic layers (CBAC ∩ DIFC ∩ Workflow) plus the Arbiter are authoritative; zero-byte NOT_SENT is the physical proof of denial. Never describe Guard V6 as the final authority.
5. If discussing attacks (indirect prompt injections, data exfiltration via markdown images or fetch, rug-pulls), provide deep technical explanations of how DIFC taint tracking and CBAC stop them at the physical socket layer (0 bytes dispatched).
6. Never invent receipts, receipt IDs, policy YAML, or ledger counts. If the user cites a receipt id that is not in the live grounding context, say it is unknown and refuse to fabricate a trace.
7. Format your output using clean GitHub-flavored Markdown with bold headers, concise bullet points, and code/policy blocks where helpful.`;
            // Build conversation history messages
            const conversationMessages = [
                { role: 'system', content: systemPrompt },
            ];
            // Add previous conversation turns (limited to last 8 turns for latency)
            const trimmedHistory = history.slice(-8);
            for (const turn of trimmedHistory) {
                if (turn.role === 'user' || turn.role === 'assistant') {
                    conversationMessages.push({
                        role: turn.role,
                        content: turn.content,
                    });
                }
            }
            // Add current user question
            conversationMessages.push({
                role: 'user',
                content: question,
            });
            // Attempt 1: Query local low-latency Ollama chat model (qwen2.5:1.5b)
            let answer = null;
            let usedModel = 'qwen2.5:1.5b';
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 12000);
                const ollamaRes = await fetch('http://localhost:11434/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'qwen2.5:1.5b',
                        messages: conversationMessages,
                        stream: false,
                        options: {
                            temperature: 0.3,
                            num_predict: 800,
                        },
                    }),
                    signal: controller.signal,
                });
                clearTimeout(timeout);
                if (ollamaRes.ok) {
                    const data = (await ollamaRes.json());
                    const rawAnswer = data?.message?.content?.trim() || null;
                    // Guard v6 training refusal detection filter
                    const isClassifierRefusal = rawAnswer && (rawAnswer.includes("don't have access to the internal decision-making log") ||
                        rawAnswer.includes("unable to delve into exfiltration") ||
                        rawAnswer.includes("My authorized response is limited"));
                    if (!isClassifierRefusal) {
                        answer = rawAnswer;
                    }
                }
            }
            catch (e) {
                answer = null;
            }
            // Attempt 2: If Ollama is unavailable, return honest grounding — never invent receipts/tools
            if (!answer) {
                usedModel = 'live-grounding-only';
                const recent = receipts.slice(0, 5).map((r) => {
                    const rid = r.receipt_id || r.request_id || '—';
                    return `- \`${r.tool_name || 'tool'}\` → ${r.decision || r.arbiter_decision || '—'} (${r.reason_code || 'n/a'}) · receipt \`${rid}\``;
                });
                answer = `### Live grounding (chat model unavailable)

The local chat model did not return an answer. Below is **only** live gateway state — no synthetic receipts or invented tools.

- Gateway: **${isLive ? 'ONLINE' : 'OFFLINE'}**
- Environment: **${protection?.result || status?.environment_state || 'UNKNOWN'}**
- Servers: **${total_servers}** (${total_mediated} mediated)
- Policy: \`${policyId}\`${policyHash !== 'unavailable' ? ` · hash \`${String(policyHash).slice(0, 16)}…\`` : ' · hash unavailable'}
- Ledger receipts: **${totalReceipts == null ? 'unavailable' : totalReceipts}** · zero-byte: **${zeroByteBlocks == null ? 'unavailable' : zeroByteBlocks}**
- Chain: **${chainIntegrity}**

${contextEvent ? `#### Focus event\n- Tool: \`${contextEvent.toolName || '—'}\`\n- Agent: \`${contextEvent.agent || '—'}\`\n- Status: ${contextEvent.status || '—'}\n- Receipt: \`${contextEvent.receiptId || '—'}\`\n` : ''}
#### Recent live receipts
${recent.length ? recent.join('\n') : '_No receipts loaded._'}

#### Discovered tools (introspection only)
${toolSummaries.length ? toolSummaries.slice(0, 20).map((t) => `- ${t}`).join('\n') : '_No tools introspected yet (empty tools[])._'}

Start Ollama / configure a local model for conversational answers. Until then, use Activity, Audit, and Explain on a real receipt id.`;
            }
            writeJson(res, 200, {
                answer,
                model: usedModel,
                grounding: {
                    result: protection?.result || status?.environment_state || 'UNKNOWN',
                    total_servers,
                    total_mediated,
                    policy_id: policyId,
                    policy_hash: policyHash === 'unavailable' ? null : policyHash,
                    generation: status?.current_generation ?? null,
                    ledger_integrity: chainRaw === true || chainRaw === 'VALID' || chainRaw === 'valid'
                        ? true
                        : chainRaw === false || chainRaw === 'FAILED' || chainRaw === 'COMPROMISED'
                            ? false
                            : null,
                    total_receipts: totalReceipts,
                    zero_byte_enforcements: zeroByteBlocks ?? null,
                    source: isLive ? 'live-gateway' : 'unavailable',
                },
            });
            return true;
        }
        // ── POST /api/gateway/escalation/allow|block|resolve ───────────────────────
        if ((pathname === '/api/gateway/escalation/allow' ||
            pathname === '/api/gateway/escalation/block' ||
            pathname === '/api/gateway/escalation/resolve') &&
            method === 'POST') {
            const body = await readBody(req);
            const receiptId = String(body['receipt_id'] || body['receiptId'] || '').trim();
            if (!receiptId) {
                writeJson(res, 400, { error: 'receipt_id required' });
                return true;
            }
            const allowedActions = new Set([
                'allow',
                'allow_once',
                'allow_always',
                'always',
                'block',
                'block_permanently',
                'permanent_block',
                'allow_similar',
                'similar',
                'session',
                'destination',
                'tool',
                'quarantine',
            ]);
            let action = pathname.endsWith('/block')
                ? 'block'
                : pathname.endsWith('/allow')
                    ? 'allow_once'
                    : 'allow_once';
            const rawAction = String(body['action'] || '').toLowerCase();
            if (pathname.endsWith('/resolve') && allowedActions.has(rawAction)) {
                action = rawAction;
            }
            try {
                const result = await client.resolveEscalation({
                    receiptId,
                    action,
                    confirmation: true,
                    remainingUses: typeof body['remaining_uses'] === 'number' ? body['remaining_uses'] : undefined,
                    ttlSeconds: typeof body['ttl_seconds'] === 'number' ? body['ttl_seconds'] : undefined,
                    expiresAt: typeof body['expires_at'] === 'number' ? body['expires_at'] : undefined,
                    scopeDetails: body['scope_details'] ? String(body['scope_details']) : undefined,
                    destination: body['destination'] ? String(body['destination']) : undefined,
                    sessionId: body['session_id'] ? String(body['session_id']) : undefined,
                    operator: body['operator'] ? String(body['operator']) : undefined,
                });
                writeJson(res, 200, result);
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, { error: err.message, code: err.code });
                }
                else if (err instanceof GatewayError) {
                    writeJson(res, err.statusCode || 500, { error: err.message, code: err.code, details: err.details });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/lockdown ──────────────────────────────────────────────
        if (pathname === '/api/gateway/lockdown' && method === 'GET') {
            try {
                writeJson(res, 200, await client.lockdownState());
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, { error: err.message, code: err.code, status: 'UNAVAILABLE' });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── POST /api/gateway/lockdown/apply ───────────────────────────────────────
        if (pathname === '/api/gateway/lockdown/apply' && method === 'POST') {
            const body = await readBody(req);
            try {
                const result = await client.lockdownApply({
                    mode: String(body['mode'] || ''),
                    scope: String(body['scope'] || ''),
                    target: body['target'] ? String(body['target']) : undefined,
                    reason: body['reason'] ? String(body['reason']) : undefined,
                    ttlSeconds: typeof body['ttl_seconds'] === 'number' ? body['ttl_seconds'] : undefined,
                    expiresAt: typeof body['expires_at'] === 'number' ? body['expires_at'] : undefined,
                    operator: body['operator'] ? String(body['operator']) : undefined,
                });
                writeJson(res, 200, result);
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, { error: err.message, code: err.code });
                }
                else if (err instanceof GatewayError) {
                    writeJson(res, err.statusCode || 500, { error: err.message, code: err.code, details: err.details });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── POST /api/gateway/lockdown/release ─────────────────────────────────────
        if (pathname === '/api/gateway/lockdown/release' && method === 'POST') {
            const body = await readBody(req);
            const controlId = String(body['control_id'] || body['controlId'] || '').trim();
            if (!controlId) {
                writeJson(res, 400, { error: 'control_id required' });
                return true;
            }
            try {
                writeJson(res, 200, await client.lockdownRelease(controlId, body['operator'] ? String(body['operator']) : undefined));
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, { error: err.message, code: err.code });
                }
                else if (err instanceof GatewayError) {
                    writeJson(res, err.statusCode || 500, { error: err.message, code: err.code, details: err.details });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/attack-lab/owasp-mcp ──────────────────────────────────
        // Prefer live gateway catalog; fall back to repo schemas/owasp-mcp-attack-lab.json.
        // Never invent pass rates — pass_rate stays null.
        if (pathname === '/api/gateway/attack-lab/owasp-mcp' && method === 'GET') {
            const loadLocalCatalog = async () => {
                try {
                    const { readFileSync, existsSync } = await import('node:fs');
                    const { join } = await import('node:path');
                    const candidates = [
                        join(process.cwd(), 'schemas', 'owasp-mcp-attack-lab.json'),
                        join(process.cwd(), '..', 'schemas', 'owasp-mcp-attack-lab.json'),
                        join(process.cwd(), '..', '..', 'schemas', 'owasp-mcp-attack-lab.json'),
                    ];
                    for (const path of candidates) {
                        if (!existsSync(path))
                            continue;
                        const data = JSON.parse(readFileSync(path, 'utf8'));
                        return {
                            ...data,
                            pass_rate: null,
                            pass_rate_note: 'UNAVAILABLE — never invent; run live canaries / Attack Lab probes separately',
                            source: path,
                            served_by: 'bff-local-schema',
                        };
                    }
                }
                catch {
                    /* ignore */
                }
                return null;
            };
            try {
                writeJson(res, 200, await client.attackLabOwasp());
            }
            catch (err) {
                const local = await loadLocalCatalog();
                if (local) {
                    writeJson(res, 200, {
                        ...local,
                        gateway_error: err instanceof Error ? err.message : String(err),
                        note: 'Gateway catalog unavailable — serving local schema (still no fake pass rate)',
                    });
                    return true;
                }
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, {
                        error: err.message,
                        code: err.code,
                        status: 'UNAVAILABLE',
                        cases: [],
                        pass_rate: null,
                    });
                }
                else if (err instanceof GatewayError) {
                    writeJson(res, err.statusCode || 500, {
                        error: err.message,
                        code: err.code,
                        details: err.details,
                        cases: [],
                        pass_rate: null,
                    });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/tool-pin ──────────────────────────────────────────────
        if (pathname === '/api/gateway/tool-pin' && method === 'GET') {
            try {
                writeJson(res, 200, await client.toolPins());
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, { error: err.message, code: err.code, status: 'UNAVAILABLE' });
                }
                else if (err instanceof GatewayError) {
                    writeJson(res, err.statusCode || 500, { error: err.message, code: err.code, details: err.details });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/sandbox/observe-status ────────────────────────────────
        if (pathname === '/api/gateway/sandbox/observe-status' && method === 'GET') {
            try {
                writeJson(res, 200, await client.sandboxObserveStatus());
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, { status: 'UNAVAILABLE', error: err.message });
                }
                else if (err instanceof GatewayError) {
                    writeJson(res, err.statusCode || 500, { status: 'UNAVAILABLE', error: err.message });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/verification ──────────────────────────────────────────
        if (pathname === '/api/gateway/verification' && method === 'GET') {
            try {
                writeJson(res, 200, await client.continuousVerification());
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, {
                        error: err.message,
                        code: err.code,
                        status: 'UNAVAILABLE',
                        gateway: { status: 'UNAVAILABLE', last_verified_at: null, label: 'UNAVAILABLE' },
                        policy: { status: 'UNAVAILABLE', last_verified_at: null, label: 'UNAVAILABLE' },
                        chain: { status: 'UNAVAILABLE', last_verified_at: null, label: 'UNAVAILABLE' },
                        fingerprint: { status: 'UNAVAILABLE', last_verified_at: null, label: 'UNAVAILABLE' },
                    });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/drift ─────────────────────────────────────────────────
        if (pathname === '/api/gateway/drift' && method === 'GET') {
            try {
                writeJson(res, 200, await client.driftClasses());
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, {
                        error: err.message,
                        code: err.code,
                        status: 'UNAVAILABLE',
                        policy_drift: { class: 'policy', label: 'Policy drift', status: 'UNAVAILABLE', events: [] },
                        behavior_drift: { class: 'behavior', label: 'Behavior drift', status: 'UNAVAILABLE' },
                        authority_drift: { class: 'authority', label: 'Authority drift', status: 'UNAVAILABLE', flips: [] },
                    });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/activity-timeline ─────────────────────────────────────
        if (pathname === '/api/gateway/activity-timeline' && method === 'GET') {
            const u = new URL(req.url || '', 'http://localhost');
            const limit = Math.min(500, Math.max(1, Number(u.searchParams.get('limit') || 100)));
            try {
                writeJson(res, 200, await client.activityTimeline(limit));
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, {
                        error: err.message,
                        code: err.code,
                        status: 'UNAVAILABLE',
                        items: [],
                        count: 0,
                    });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/escalations ───────────────────────────────────────────
        if (pathname === '/api/gateway/escalations' && method === 'GET') {
            const u = new URL(req.url || '', 'http://localhost');
            const st = (u.searchParams.get('status') || 'open');
            try {
                const result = await client.escalations(st);
                writeJson(res, 200, result);
            }
            catch (err) {
                if (err instanceof GatewayUnavailableError || err instanceof GatewayVersionMismatchError) {
                    writeJson(res, err.statusCode || 503, { error: err.message, code: err.code });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/operator-grants ────────────────────────────────────────
        if (pathname === '/api/gateway/operator-grants' && method === 'GET') {
            const u = new URL(req.url || '', 'http://localhost');
            const limit = Math.min(500, Math.max(1, Number(u.searchParams.get('limit') || 100)));
            try {
                writeJson(res, 200, await client.operatorGrants(limit));
            }
            catch (err) {
                // Gateway older than this BFF → honest UNAVAILABLE (not "route not found" on BFF).
                if (err instanceof GatewayUnavailableError ||
                    err instanceof GatewayVersionMismatchError ||
                    err instanceof GatewayError) {
                    writeJson(res, err instanceof GatewayError && err.statusCode === 404 ? 503 : err.statusCode || 503, {
                        error: err.message,
                        code: err instanceof GatewayError ? err.code : 'GATEWAY_UNAVAILABLE',
                        active: [],
                        expiring_lt_1h: [],
                        expired: [],
                        status: 'UNAVAILABLE',
                        hint: 'Restart gateway: cd mastyf_gateway && python3 -m mastyf_gateway.cli serve --port 8443',
                    });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/alerting-status ───────────────────────────────────────
        if (pathname === '/api/gateway/alerting-status' && method === 'GET') {
            try {
                const { isAppAlertingConfigured, getAlertDestinationsForLogging } = await import('../alerting/alert-env.js');
                writeJson(res, 200, {
                    configured: isAppAlertingConfigured(),
                    destinations: getAlertDestinationsForLogging(),
                    rules: {
                        guard_offline: 'env-webhook',
                        unmediated_discovered: 'prometheus-alert-rules (local obs stack)',
                        block_rate_spike: 'MastyfHighBlockRate',
                        bff_scrape_down: 'MastyfGatewayScrapeDown',
                        redis_down: 'MastyfRedisDown',
                        semantic_llm_offline: 'MastyfSemanticLlmOffline',
                        rug_pull_drift: 'MastyfRugPullDetected',
                        decide_p95: 'MastyfDecideP95High (mastyf_ai_decide_latency_ms) + in-app SLO (n≥5, 800ms)',
                        escalation_backlog: 'MastyfEscalateBacklog + in-app SLO — mastyf_ai_escalate_backlog',
                        chain_integrity: 'MastyfLedgerChainBroken + in-app SLO — mastyf_ai_ledger_chain_valid',
                        self_test_stale: 'MastyfSelfTestStale + in-app SLO — mastyf_ai_self_test_age_seconds > 86400',
                    },
                    alertmanager_rules_file: 'deploy/observability/alert-rules.yml',
                    note: 'Destinations from ALERT_SLACK_WEBHOOK / ALERT_PAGERDUTY_KEY. Threshold rules: deploy/observability/alert-rules.yml via pnpm obs:up',
                    source: 'bff-alert-env',
                });
            }
            catch (err) {
                writeJson(res, 200, {
                    configured: false,
                    destinations: 'none',
                    status: 'UNAVAILABLE',
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            return true;
        }
        // ── GET /api/gateway/observability-status ──────────────────────────────────
        if (pathname === '/api/gateway/observability-status' && method === 'GET') {
            const otelEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ||
                process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] ||
                null;
            const otelConfigured = Boolean(otelEndpoint || process.env['OTEL_ENABLED'] === 'true' || process.env['MASTYF_OTEL_ENABLED'] === 'true');
            const metricsPort = process.env['METRICS_PORT'] || (process.env['METRICS_ENABLED'] === 'true' ? '9090' : null);
            async function probe(url) {
                try {
                    const ac = new AbortController();
                    const t = setTimeout(() => ac.abort(), 1500);
                    const r = await fetch(url, { signal: ac.signal }).catch(() => null);
                    clearTimeout(t);
                    if (!r)
                        return { ok: false, status: null, detail: 'UNAVAILABLE — unreachable' };
                    return {
                        ok: r.ok || r.status === 404,
                        status: r.status,
                        detail: r.ok || r.status === 404 ? `HTTP ${r.status}` : `HTTP ${r.status}`,
                    };
                }
                catch (e) {
                    return {
                        ok: false,
                        status: null,
                        detail: e instanceof Error ? e.message : 'UNAVAILABLE',
                    };
                }
            }
            const collectorBase = otelEndpoint
                ? otelEndpoint.replace(/\/$/, '').replace(/\/v1\/traces$/, '')
                : 'http://127.0.0.1:4318';
            const [collector_probe, prometheus_probe] = await Promise.all([
                otelConfigured
                    ? probe(`${collectorBase}/`)
                    : Promise.resolve({ ok: false, status: null, detail: 'UNAVAILABLE — OTEL unset' }),
                metricsPort
                    ? probe(`http://127.0.0.1:${metricsPort}/metrics`)
                    : Promise.resolve({ ok: false, status: null, detail: 'UNAVAILABLE — metrics unset' }),
            ]);
            writeJson(res, 200, {
                otel_configured: otelConfigured,
                otel_endpoint: otelEndpoint || null,
                metrics_port: metricsPort,
                grafana_trace_url_set: Boolean(process.env['NEXT_PUBLIC_MASTYF_GRAFANA_TRACE_URL']),
                grafana_metrics_url_set: Boolean(process.env['NEXT_PUBLIC_MASTYF_GRAFANA_METRICS_URL']),
                grafana_trace_url: process.env['NEXT_PUBLIC_MASTYF_GRAFANA_TRACE_URL'] || LOCAL_OBS_GRAFANA_TRACE_URL,
                grafana_trace_url_defaulted: !process.env['NEXT_PUBLIC_MASTYF_GRAFANA_TRACE_URL'],
                grafana_metrics_url: process.env['NEXT_PUBLIC_MASTYF_GRAFANA_METRICS_URL'] || null,
                collector_probe,
                prometheus_probe,
                note: 'Local LGTM: pnpm obs:up · see deploy/observability/README.md',
                source: 'bff-observability-status',
            });
            return true;
        }
        // ── GET/POST /api/gateway/incidents ────────────────────────────────────────
        // Lightweight sealed incident graph (JSONL under ~/.mastyf/incidents.jsonl).
        if (pathname === '/api/gateway/incidents' && method === 'GET') {
            try {
                const { homedir } = await import('node:os');
                const { join } = await import('node:path');
                const { readFileSync, existsSync } = await import('node:fs');
                const file = join(homedir(), '.mastyf', 'incidents.jsonl');
                if (!existsSync(file)) {
                    writeJson(res, 200, { incidents: [], source: 'live-incident-graph', status: 'empty' });
                    return true;
                }
                const limit = Math.min(200, Math.max(1, Number(new URL(req.url || '', 'http://localhost').searchParams.get('limit') || 50)));
                const rows = readFileSync(file, 'utf8')
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => {
                    try {
                        return JSON.parse(line);
                    }
                    catch {
                        return null;
                    }
                })
                    .filter(Boolean)
                    .slice(-limit)
                    .reverse();
                writeJson(res, 200, { incidents: rows, count: rows.length, source: 'live-incident-graph' });
            }
            catch (err) {
                writeJson(res, 200, {
                    incidents: [],
                    status: 'UNAVAILABLE',
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            return true;
        }
        if (pathname === '/api/gateway/incidents' && method === 'POST') {
            try {
                const body = await readBody(req);
                const { homedir } = await import('node:os');
                const { join } = await import('node:path');
                const { appendFileSync, mkdirSync, existsSync } = await import('node:fs');
                const dir = join(homedir(), '.mastyf');
                if (!existsSync(dir))
                    mkdirSync(dir, { recursive: true, mode: 0o700 });
                const incident = {
                    incident_id: String(body['incident_id'] || `inc_${Date.now().toString(36)}`),
                    created_at: new Date().toISOString(),
                    receipt_ids: Array.isArray(body['receipt_ids'])
                        ? body['receipt_ids'].map(String)
                        : body['receipt_id']
                            ? [String(body['receipt_id'])]
                            : [],
                    control_receipt_ids: Array.isArray(body['control_receipt_ids'])
                        ? body['control_receipt_ids'].map(String)
                        : [],
                    threat_candidate_id: body['threat_candidate_id']
                        ? String(body['threat_candidate_id'])
                        : null,
                    policy_generation: typeof body['policy_generation'] === 'number' ? body['policy_generation'] : null,
                    evidence_pack_hash: body['evidence_pack_hash']
                        ? String(body['evidence_pack_hash'])
                        : null,
                    note: body['note'] ? String(body['note']) : null,
                    source: 'operator-incident-graph',
                };
                appendFileSync(join(dir, 'incidents.jsonl'), `${JSON.stringify(incident)}\n`, {
                    encoding: 'utf8',
                    mode: 0o600,
                });
                writeJson(res, 200, { ok: true, incident });
            }
            catch (err) {
                writeJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
            }
            return true;
        }
        // ── GET /api/gateway/spend-caps ─────────────────────────────────────────────
        // Economics Caps — env limits + optional Redis utilization (never invented).
        if (pathname === '/api/gateway/spend-caps' && method === 'GET') {
            try {
                const { getSpendCapsStatus } = await import('../services/unified-spend-pool.js');
                const tenant = String(new URL(req.url || '', 'http://localhost').searchParams.get('tenant') || 'default').trim() || 'default';
                const status = await getSpendCapsStatus(tenant);
                writeJson(res, 200, status);
            }
            catch (err) {
                writeJson(res, 200, {
                    source: 'unavailable',
                    redis_configured: false,
                    caps: { tokens_per_min: null, usd_per_min: null, usd_per_day: null },
                    utilization: { tokens_per_min_used: null, usd_per_day_used: null },
                    note: err instanceof Error ? err.message : String(err),
                });
            }
            return true;
        }
        // ── GET /api/gateway/fleet/posture-digest ───────────────────────────────────
        // Hashed org posture only — never prompt bodies (Horizon C / 6.4).
        if (pathname === '/api/gateway/fleet/posture-digest' && method === 'GET') {
            try {
                const { createHash } = await import('node:crypto');
                const { homedir } = await import('node:os');
                const { join } = await import('node:path');
                const { readFileSync, existsSync } = await import('node:fs');
                const [status, policy] = await Promise.all([
                    client.status().catch(() => null),
                    client.policy().catch(() => null),
                ]);
                const st = status;
                const pol = policy;
                const policyHash = String(pol?.hash ||
                    st?.policy?.hash ||
                    'UNAVAILABLE');
                const receiptHead = st?.ledger?.head_receipt_hash ||
                    'UNAVAILABLE';
                let certSet = 'none';
                try {
                    const file = join(homedir(), '.mastyf', 'certified_catalog_digest.txt');
                    if (existsSync(file))
                        certSet = readFileSync(file, 'utf8').trim().slice(0, 64) || 'none';
                }
                catch {
                    certSet = 'none';
                }
                const material = `policy=${policyHash}|head=${receiptHead}|certs=${certSet}`;
                const digest = createHash('sha256').update(material).digest('hex');
                writeJson(res, 200, {
                    posture_digest: digest,
                    material_fields: ['policy_hash', 'receipt_head', 'cert_set'],
                    policy_hash: policyHash === 'UNAVAILABLE' ? null : policyHash,
                    receipt_head: receiptHead === 'UNAVAILABLE' ? null : receiptHead,
                    source: 'live-fleet-posture-digest',
                    note: 'Digest only — local reference monitor remains authority; no prompt contents',
                });
            }
            catch (err) {
                writeJson(res, 200, {
                    posture_digest: null,
                    status: 'UNAVAILABLE',
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            return true;
        }
        // ── POST /api/gateway/decide ───────────────────────────────────────────────
        if (pathname === '/api/gateway/decide' && method === 'POST') {
            const body = await readBody(req);
            try {
                // Normalize SPA/canary payloads onto DecideRequest fields.
                const decideBody = { ...body };
                if (decideBody['tool_args'] == null && decideBody['arguments'] != null) {
                    decideBody['tool_args'] = decideBody['arguments'];
                }
                const result = await client.decide(decideBody);
                const decideMs = result['total_latency_ms'];
                if (typeof decideMs === 'number' && Number.isFinite(decideMs)) {
                    decideLatencyMs.observe(decideMs);
                }
                writeJson(res, 200, result);
            }
            catch (err) {
                if (err instanceof GatewayError) {
                    writeJson(res, err.statusCode || 500, { error: err.message, code: err.code, details: err.details });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── POST /api/gateway/scan ─────────────────────────────────────────────────
        if (pathname === '/api/gateway/scan' && method === 'POST') {
            const body = await readBody(req);
            try {
                const names = Array.isArray(body['server_names']) ? body['server_names'] : undefined;
                const result = await client.scan(names);
                writeJson(res, 200, result);
            }
            catch (err) {
                if (err instanceof GatewayError) {
                    writeJson(res, err.statusCode || 500, { error: err.message, code: err.code, details: err.details });
                }
                else {
                    throw err;
                }
            }
            return true;
        }
        // ── GET /api/gateway/receipts/:id[/trace] ──────────────────────────────────
        {
            const m = pathname.match(/^\/api\/gateway\/receipts\/([^/]+)(\/trace)?$/);
            if (m && method === 'GET') {
                const rid = decodeURIComponent(m[1]);
                // Reserved path segments — never proxy as receipt ids (stale BFF / route-order safety).
                const reserved = new Set(['stats', 'siem-status']);
                if (reserved.has(rid.toLowerCase()) && !m[2]) {
                    // Re-dispatch mentally: client should hit exact /receipts/stats; defend here anyway.
                    writeJson(res, 404, {
                        error: `Reserved receipt path '${rid}' — use GET /api/gateway/receipts/stats?window=24h`,
                        code: 'RESERVED_RECEIPT_PATH',
                    });
                    return true;
                }
                try {
                    const result = m[2]
                        ? await client.receiptTrace(rid)
                        : await client.receiptById(rid);
                    writeJson(res, 200, result);
                }
                catch (err) {
                    if (err instanceof GatewayError) {
                        writeJson(res, err.statusCode || 500, { error: err.message, code: err.code, details: err.details });
                    }
                    else {
                        throw err;
                    }
                }
                return true;
            }
        }
        // ── GET /api/gateway/threat-lab/from-receipts ─────────────────────────────
        if (pathname === '/api/gateway/threat-lab/from-receipts' && method === 'GET') {
            try {
                const { homedir } = await import('node:os');
                const { join } = await import('node:path');
                const { readFileSync, existsSync } = await import('node:fs');
                const file = join(homedir(), '.mastyf', 'threat_lab_from_receipts.jsonl');
                if (!existsSync(file)) {
                    writeJson(res, 200, { candidates: [], source: 'live-ledger', path: file });
                    return true;
                }
                const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
                const candidates = lines
                    .slice(-100)
                    .map((line) => {
                    try {
                        return JSON.parse(line);
                    }
                    catch {
                        return null;
                    }
                })
                    .filter(Boolean)
                    .reverse();
                writeJson(res, 200, {
                    candidates,
                    source: 'live-ledger',
                    note: 'pending_human_accept — never auto-applied',
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                writeJson(res, 500, { error: msg });
            }
            return true;
        }
        // ── POST /api/gateway/threat-lab/from-receipt ──────────────────────────────
        if (pathname === '/api/gateway/threat-lab/from-receipt' && method === 'POST') {
            const body = await readBody(req);
            const receiptId = String(body['receipt_id'] || body['receiptId'] || '').trim();
            if (!receiptId) {
                writeJson(res, 400, { error: 'receipt_id required' });
                return true;
            }
            try {
                const { homedir } = await import('node:os');
                const { join } = await import('node:path');
                const { appendFileSync, mkdirSync, existsSync } = await import('node:fs');
                const dir = join(homedir(), '.mastyf');
                if (!existsSync(dir))
                    mkdirSync(dir, { recursive: true });
                const candidate = {
                    id: `tl-receipt-${receiptId.slice(0, 24)}-${Date.now().toString(36)}`,
                    created_at: new Date().toISOString(),
                    source: 'appliance_receipt',
                    receipt_id: receiptId,
                    tool_name: body['tool_name'] || null,
                    server_name: body['server_name'] || null,
                    reason_code: body['reason_code'] || null,
                    decision: body['decision'] || null,
                    narrative: body['narrative'] || null,
                    status: 'pending_human_accept',
                    provenance: { source: 'live-ledger', receipt_id: receiptId },
                };
                appendFileSync(join(dir, 'threat_lab_from_receipts.jsonl'), `${JSON.stringify(candidate)}\n`, 'utf8');
                writeJson(res, 200, { ok: true, candidate });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                writeJson(res, 500, { error: msg });
            }
            return true;
        }
        // ── GET /api/gateway/evidence-pack ─────────────────────────────────────────
        // Live-ledger evidence pack assembled on BFF (no client-side self-test side effect).
        // Optional ?include_self_test=1 runs self-test explicitly.
        if (pathname === '/api/gateway/evidence-pack' && method === 'GET') {
            try {
                const includeSelfTest = parsedUrl.searchParams.get('include_self_test') === '1';
                const windowParam = parsedUrl.searchParams.get('window') || undefined;
                const [status, protection, policy, receiptsPage, controlPage, serversStats, manifest, windowStats] = await Promise.all([
                    client.status().catch(() => null),
                    client.protection().catch(() => null),
                    client.policy().catch(() => null),
                    client.receipts({ limit: 50 }).catch(() => ({ receipts: [] })),
                    client.controlReceipts({ limit: 50 }).catch(() => ({ receipts: [] })),
                    client.serverStats().catch(() => ({ servers: [] })),
                    client.deploymentManifest().catch(() => null),
                    windowParam
                        ? client.receiptStats({ window: windowParam }).catch((err) => ({
                            error: err instanceof Error ? err.message : String(err),
                            window: windowParam,
                        }))
                        : Promise.resolve(null),
                ]);
                const receiptList = Array.isArray(receiptsPage?.receipts)
                    ? receiptsPage.receipts
                    : [];
                const controlList = Array.isArray(controlPage?.receipts)
                    ? controlPage.receipts
                    : Array.isArray(controlPage?.control_receipts)
                        ? controlPage.control_receipts
                        : [];
                const narrativeStops = receiptList
                    .filter((r) => r.decision === 'BLOCK' || r.decision === 'ESCALATE')
                    .slice(0, 20)
                    .map((r) => ({
                    receipt_id: r.receipt_id || r.request_id,
                    tool: r.tool_name,
                    server: r.server_name || r.server_id,
                    decision: r.decision,
                    reason_code: r.reason_code || r.enforcement_reason,
                    backend_execution_count: r.backend_execution_count ?? 0,
                    claim: Number(r.backend_execution_count ?? 0) === 0
                        ? 'Attack never reached server — NOT_SENT + backend_execution_count=0'
                        : 'Execution observed — review bytes',
                }));
                // Live ActionTrace JSON for recent receipts (prefer blocks/escalates, then newest)
                const traceCandidates = [
                    ...narrativeStops.map((n) => String(n.receipt_id || '')),
                    ...receiptList
                        .map((r) => String(r.receipt_id || r.request_id || ''))
                        .filter(Boolean),
                ]
                    .filter((id, i, arr) => id && arr.indexOf(id) === i)
                    .slice(0, 10);
                const actionTraces = [];
                for (const rid of traceCandidates) {
                    try {
                        const tr = await client.receiptTrace(rid);
                        actionTraces.push({
                            receipt_id: rid,
                            source: 'live-gateway-trace',
                            ...(tr && typeof tr === 'object' ? tr : { error: 'empty-trace' }),
                        });
                    }
                    catch (err) {
                        actionTraces.push({
                            receipt_id: rid,
                            source: 'live-gateway-trace',
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
                let selfTest = {
                    skipped: true,
                    note: 'Pass include_self_test=1 to run; not invoked by default (no side effect).',
                };
                if (includeSelfTest) {
                    selfTest = await client.selfTest().catch((err) => ({
                        error: err instanceof Error ? err.message : String(err),
                    }));
                }
                writeJson(res, 200, {
                    exported_at: new Date().toISOString(),
                    source: 'live-gateway',
                    assembled_by: 'bff-evidence-pack',
                    authority: 'mastyf',
                    system_of_record: {
                        claim: 'Compliance = control mapping over live objects. Evidence Pack = auditor artifact proving attack never reached server when NOT_SENT + backend_execution_count=0.',
                        action_receipt_schema: 'schemas/action-receipt.schema.json',
                        owasp_attack_lab_catalog: 'schemas/owasp-mcp-attack-lab.json',
                        canaries: 'POST /v1/self-test (50 cases) — Attack Lab is additive, never a substitute pass rate',
                        no_fake_scores: true,
                    },
                    status,
                    protection,
                    policy,
                    ledger_summary: {
                        receipts_loaded: receiptList.length,
                        control_receipts_loaded: controlList.length,
                        chain_integrity: status?.ledger
                            ?.chain_integrity,
                        zero_byte_enforcements: status
                            ?.ledger?.zero_byte_enforcements,
                        window_stats: windowStats,
                    },
                    recent_execution_receipts: receiptList,
                    recent_control_receipts: controlList,
                    action_traces: actionTraces,
                    server_stats: serversStats,
                    incident_narratives: narrativeStops,
                    deployment_manifest: manifest,
                    self_test: selfTest,
                    flywheel: await (async () => {
                        let openEscalations = 0;
                        let threatPending = 0;
                        try {
                            const esc = (await client.escalations('open').catch(() => null));
                            openEscalations = Number(esc?.count ?? 0);
                        }
                        catch {
                            /* ignore */
                        }
                        try {
                            const { homedir } = await import('node:os');
                            const { join } = await import('node:path');
                            const { readFileSync, existsSync } = await import('node:fs');
                            const file = join(homedir(), '.mastyf', 'threat_lab_from_receipts.jsonl');
                            if (existsSync(file)) {
                                threatPending = readFileSync(file, 'utf8')
                                    .split('\n')
                                    .filter(Boolean)
                                    .map((line) => {
                                    try {
                                        return JSON.parse(line);
                                    }
                                    catch {
                                        return null;
                                    }
                                })
                                    .filter((row) => row && (!row.status || row.status === 'pending_human_accept'))
                                    .length;
                            }
                        }
                        catch {
                            /* ignore */
                        }
                        return {
                            open_escalations: openEscalations,
                            threat_lab_pending_human_accept: threatPending,
                            note: 'Horizon B flywheel counters — live only, never invented',
                        };
                    })(),
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                writeJson(res, 500, { error: msg });
            }
            return true;
        }
        // ── POST /api/gateway/threat-lab/from-receipt/review ───────────────────────
        // Human accept/reject for from-receipt candidates. Accept requires
        // human_accept + corpus_replay_passed — never auto-applies policy.
        if (pathname === '/api/gateway/threat-lab/from-receipt/review' && method === 'POST') {
            const body = await readBody(req);
            const candidateId = String(body['id'] || body['candidate_id'] || '').trim();
            const action = String(body['action'] || '').trim().toLowerCase();
            if (!candidateId || (action !== 'accept' && action !== 'reject')) {
                writeJson(res, 400, { error: 'id and action=accept|reject required' });
                return true;
            }
            if (action === 'accept') {
                if (body['human_accept'] !== true) {
                    writeJson(res, 400, {
                        error: 'human_accept:true required — Harden never auto-applies',
                        code: 'HUMAN_ACCEPT_REQUIRED',
                    });
                    return true;
                }
                if (body['corpus_replay_passed'] !== true) {
                    writeJson(res, 400, {
                        error: 'corpus_replay_passed:true required before accept',
                        code: 'REPLAY_GATE_REQUIRED',
                    });
                    return true;
                }
            }
            try {
                const { homedir } = await import('node:os');
                const { join } = await import('node:path');
                const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
                const file = join(homedir(), '.mastyf', 'threat_lab_from_receipts.jsonl');
                if (!existsSync(file)) {
                    writeJson(res, 404, { error: 'No from-receipt candidates file' });
                    return true;
                }
                const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
                let foundRow = null;
                const updated = lines.map((line) => {
                    try {
                        const row = JSON.parse(line);
                        if (row.id !== candidateId)
                            return line;
                        foundRow = row;
                        row.status =
                            action === 'accept' ? 'accepted_pending_policy' : 'rejected';
                        row.reviewed_at = new Date().toISOString();
                        row.human_accept = action === 'accept';
                        row.corpus_replay_passed = action === 'accept' ? true : Boolean(body['corpus_replay_passed']);
                        row.note =
                            action === 'accept'
                                ? 'Accepted after human + replay — still requires Rules activate (never auto-applied)'
                                : 'Rejected by operator';
                        return JSON.stringify(row);
                    }
                    catch {
                        return line;
                    }
                });
                if (!foundRow) {
                    writeJson(res, 404, { error: `Candidate ${candidateId} not found` });
                    return true;
                }
                writeFileSync(file, `${updated.join('\n')}\n`, 'utf8');
                const toolHint = String(foundRow['tool_name'] || 'unknown');
                writeJson(res, 200, {
                    ok: true,
                    id: candidateId,
                    action,
                    policy_auto_applied: false,
                    note: action === 'accept'
                        ? 'Staged only — activate policy via Rules with confirmation'
                        : 'Rejected',
                    propose_intent: action === 'accept'
                        ? `Harden from Threat Lab candidate ${candidateId}: gate or block tool "${toolHint}" (server ${String(foundRow['server_name'] || 'unknown')}). Stage only — never auto-apply.`
                        : null,
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                writeJson(res, 500, { error: msg });
            }
            return true;
        }
        // ── POST /api/gateway/threat-lab/corpus-replay ─────────────────────────────
        // Re-run decide against the live receipt's tool — human still must accept.
        // passed=true only when decision remains BLOCK|ESCALATE (policy still catches).
        if (pathname === '/api/gateway/threat-lab/corpus-replay' && method === 'POST') {
            const body = await readBody(req);
            const candidateId = String(body['id'] || body['candidate_id'] || '').trim();
            const receiptId = String(body['receipt_id'] || body['receiptId'] || '').trim();
            if (!candidateId && !receiptId) {
                writeJson(res, 400, { error: 'id or receipt_id required' });
                return true;
            }
            try {
                const { homedir } = await import('node:os');
                const { join } = await import('node:path');
                const { readFileSync, existsSync } = await import('node:fs');
                let toolName = String(body['tool_name'] || '').trim();
                let serverName = String(body['server_name'] || '').trim();
                let rid = receiptId;
                if (candidateId) {
                    const file = join(homedir(), '.mastyf', 'threat_lab_from_receipts.jsonl');
                    if (existsSync(file)) {
                        for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
                            try {
                                const row = JSON.parse(line);
                                if (row.id === candidateId) {
                                    toolName = toolName || String(row.tool_name || '');
                                    serverName = serverName || String(row.server_name || '');
                                    rid = rid || String(row.receipt_id || '');
                                    break;
                                }
                            }
                            catch {
                                /* skip */
                            }
                        }
                    }
                }
                if (!toolName) {
                    writeJson(res, 400, { error: 'tool_name unavailable for replay' });
                    return true;
                }
                const decide = (await client.decide({
                    tool_name: toolName,
                    tool_args: body['tool_args'] && typeof body['tool_args'] === 'object' ? body['tool_args'] : {},
                    principal_id: 'threat-lab-corpus-replay',
                    session_id: `corpus-replay-${candidateId || rid || 'anon'}`,
                    server_name: serverName || undefined,
                }));
                const finalDecision = String(decide.final_decision || decide.decision || decide.arbiter_decision || '').toUpperCase();
                const passed = finalDecision === 'BLOCK' || finalDecision === 'ESCALATE';
                writeJson(res, 200, {
                    ok: true,
                    candidate_id: candidateId || null,
                    receipt_id: rid || null,
                    tool_name: toolName,
                    final_decision: finalDecision || null,
                    corpus_replay_passed: passed,
                    policy_auto_applied: false,
                    note: passed
                        ? 'Replay still blocks/escalates — operator may mark accept after human review'
                        : 'Replay ALLOWED — do not accept Harden candidate without policy change',
                    decide,
                });
            }
            catch (err) {
                if (err instanceof GatewayError) {
                    writeJson(res, err.statusCode || 500, { error: err.message, code: err.code });
                }
                else {
                    const msg = err instanceof Error ? err.message : String(err);
                    writeJson(res, 500, { error: msg });
                }
            }
            return true;
        }
        // ── GET /api/gateway/certified-catalog ─────────────────────────────────────
        // Horizon C starter: live discovered servers ∩ history cert registry.
        // Never sets certified:true without a registry attestation row.
        if (pathname === '/api/gateway/certified-catalog' && method === 'GET') {
            try {
                const [serversRaw, statsRaw, policy] = await Promise.all([
                    client.servers().catch(() => ({ servers: [] })),
                    client.serverStats().catch(() => ({ servers: [] })),
                    client.policy().catch(() => null),
                ]);
                const discovered = Array.isArray(serversRaw?.servers)
                    ? serversRaw.servers
                    : Array.isArray(serversRaw)
                        ? serversRaw
                        : [];
                const stats = Array.isArray(statsRaw?.servers)
                    ? statsRaw.servers
                    : [];
                let certifications = [];
                let registrySource = 'unavailable';
                try {
                    const base = `http://127.0.0.1:${process.env['DASHBOARD_PORT'] || process.env['MASTYF_AI_PORT'] || 4000}`;
                    const regRes = await fetch(`${base}/api/certification/registry`);
                    if (regRes.ok) {
                        const reg = (await regRes.json());
                        certifications = Array.isArray(reg.certifications) ? reg.certifications : [];
                        registrySource = reg.available === false ? 'history-db-unavailable' : 'history-db';
                    }
                }
                catch {
                    registrySource = 'history-db-unreachable';
                }
                const byName = new Map();
                for (const c of certifications) {
                    const name = String(c.serverName || c.server_name || '').toLowerCase();
                    if (name)
                        byName.set(name, c);
                }
                const catalog = discovered.map((s) => {
                    const name = String(s.name || s.server_name || s.server_id || 'unknown');
                    const cert = byName.get(name.toLowerCase());
                    const st = stats.find((x) => String(x.server_name || x.server_id || '').toLowerCase() === name.toLowerCase());
                    return {
                        server_name: name,
                        transport: s.transport || null,
                        tools_count: Array.isArray(s.tools) ? s.tools.length : s.tools_count ?? null,
                        ledger: st
                            ? {
                                total: st.total ?? null,
                                blocked: st.blocked ?? null,
                                escalated: st.escalated ?? null,
                            }
                            : null,
                        certified: Boolean(cert && cert.certified !== false && cert.level),
                        certification: cert
                            ? {
                                level: cert.level ?? null,
                                score: cert.score ?? null,
                                expires_at: cert.expiresAt || cert.expires_at || null,
                                attested: cert.certified === false,
                            }
                            : null,
                        source: 'live-discovery',
                    };
                });
                const pol = policy;
                const requireCert = pol?.require_certification ||
                    pol?.policy
                        ?.require_certification ||
                    null;
                // Horizon C1: signed pin honesty — READY only when a signing key file exists
                let signingReady = false;
                let signedPinReason = 'Signing key not configured (MASTYF_CERT_SIGNING_KEY or ~/.mastyf/signing/ed25519.pem)';
                let fingerprint = null;
                try {
                    const { existsSync, readFileSync } = await import('node:fs');
                    const { createHash } = await import('node:crypto');
                    const { join } = await import('node:path');
                    const { homedir } = await import('node:os');
                    const envKey = process.env['MASTYF_CERT_SIGNING_KEY'];
                    const defaultKey = join(homedir(), '.mastyf', 'signing', 'ed25519.pem');
                    let keyPath = null;
                    if (envKey && existsSync(envKey)) {
                        signingReady = true;
                        keyPath = envKey;
                        signedPinReason = `Signing key present (${envKey})`;
                    }
                    else if (existsSync(defaultKey)) {
                        signingReady = true;
                        keyPath = defaultKey;
                        signedPinReason = 'Signing key present (~/.mastyf/signing/ed25519.pem)';
                    }
                    if (keyPath) {
                        const pem = readFileSync(keyPath, 'utf8');
                        fingerprint = createHash('sha256').update(pem).digest('hex').slice(0, 16);
                    }
                }
                catch {
                    signingReady = false;
                    fingerprint = null;
                }
                // Prefer explicit security-profile mediation.certified_only when BFF can read it
                let certifiedOnlyFromProfile = false;
                try {
                    const { existsSync, readFileSync } = await import('node:fs');
                    const { join } = await import('node:path');
                    const { homedir } = await import('node:os');
                    const candidates = [
                        join(homedir(), '.mastyf', 'mcp-security.yaml'),
                        join(homedir(), '.mastyf', 'mcp-security.yml'),
                        join(process.cwd(), 'mcp-security.yaml'),
                    ];
                    for (const p of candidates) {
                        if (!existsSync(p))
                            continue;
                        const text = readFileSync(p, 'utf8');
                        if (/certified_only\s*:\s*true/i.test(text)) {
                            certifiedOnlyFromProfile = true;
                            break;
                        }
                    }
                }
                catch {
                    /* ignore */
                }
                const certifiedOnlyMode = Boolean(requireCert) || certifiedOnlyFromProfile;
                writeJson(res, 200, {
                    exported_at: new Date().toISOString(),
                    source: `live-gateway+${registrySource}`,
                    certified_only_mode: certifiedOnlyMode,
                    require_certification: requireCert,
                    signing_ready: signingReady,
                    signed_pin: {
                        status: signingReady ? 'READY' : 'UNAVAILABLE',
                        reason: signedPinReason,
                        fingerprint: signingReady ? fingerprint : null,
                    },
                    catalog,
                    certifications_registered: certifications.length,
                    certified_count: catalog.filter((c) => c.certified).length,
                    note: 'certified:true only when history registry has an attestation — never invented; signed pin UNAVAILABLE until signing keys exist (no Trust score)',
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                writeJson(res, 500, { error: msg });
            }
            return true;
        }
        // ── GET /api/gateway/bff-info ──────────────────────────────────────────────
        // Connection honesty: proves this process mounts gateway-routes and reports
        // history.db path fingerprint for parity with aggregate APIs.
        if (pathname === '/api/gateway/bff-info' && method === 'GET') {
            const fs = await import('fs');
            const path = await import('path');
            const { resolveMastyfAiDbPath } = await import('../utils/mastyf-ai-db-path.js');
            const historyDbPath = resolveMastyfAiDbPath();
            let historyDbExists = false;
            let historyDbBytes = null;
            try {
                const st = fs.statSync(historyDbPath);
                historyDbExists = st.isFile();
                historyDbBytes = st.size;
            }
            catch {
                historyDbExists = false;
            }
            writeJson(res, 200, {
                available: true,
                bff: 'gateway-routes',
                canonical_command: 'pnpm dashboard:proxy',
                history_db: {
                    path: historyDbPath,
                    basename: path.basename(historyDbPath),
                    exists: historyDbExists,
                    bytes: historyDbBytes,
                    env_set: Boolean(process.env['MASTYF_AI_DB_PATH']),
                },
                pid: process.pid,
            });
            return true;
        }
        // ── GET /api/gateway/runtime-health ────────────────────────────────────────
        // Unified stack health for UI + desktop (Gateway :8443 · BFF :4000 · Guard).
        // Never invents engine — mirrors live status intelligence only.
        if (pathname === '/api/gateway/runtime-health' && method === 'GET') {
            const gatewayPort = String(process.env['MASTYF_GATEWAY_PORT'] || '').trim();
            const gatewayUrl = (process.env['MASTYF_GATEWAY_URL'] ||
                process.env['MASTYF_CONTROL_URL'] ||
                (gatewayPort ? `http://127.0.0.1:${gatewayPort}` : 'http://127.0.0.1:8443')).replace(/\/$/, '');
            let gatewayOk = false;
            let gatewayDetail = null;
            try {
                const ac = new AbortController();
                const t = setTimeout(() => ac.abort(), 1500);
                const hr = await fetch(`${gatewayUrl}/healthz`, { signal: ac.signal }).catch(() => null);
                clearTimeout(t);
                gatewayOk = Boolean(hr && hr.ok);
                gatewayDetail = hr ? `HTTP ${hr.status}` : 'unreachable';
            }
            catch (err) {
                gatewayDetail = err instanceof Error ? err.message : String(err);
            }
            let status = null;
            let statusAvailable = false;
            try {
                status = (await client.status());
                statusAvailable = status?.available === true || status?.status === 'online';
            }
            catch (err) {
                status = {
                    available: false,
                    message: err instanceof Error ? err.message : String(err),
                };
            }
            const intel = (status?.intelligence || {});
            const engine = String(intel.aia_engine || 'unavailable');
            writeJson(res, 200, {
                exported_at: new Date().toISOString(),
                source: 'bff-runtime-health',
                bff: {
                    ok: true,
                    port: Number(process.env['DASHBOARD_PORT'] || process.env['MASTYF_AI_PORT'] || 4000),
                    pid: process.pid,
                    canonical_command: 'pnpm dashboard:proxy',
                },
                gateway: {
                    ok: gatewayOk,
                    url: gatewayUrl,
                    detail: gatewayDetail,
                    status_available: statusAvailable,
                },
                guard: {
                    engine,
                    model: intel.aia_model || intel.name || null,
                    backend: intel.aia_backend || null,
                    fallback_active: Boolean(intel.fallback_active),
                    fallback_reason: intel.fallback_reason || null,
                    advisory: true,
                    cannot_expand_authority: true,
                },
                stack_honest: gatewayOk &&
                    statusAvailable &&
                    (engine !== 'unavailable' || Boolean(intel.fallback_active)),
                degrade: !gatewayOk
                    ? {
                        kind: 'gateway',
                        hint: 'Start Python control API: cd mastyf_gateway && python3 -m mastyf_gateway.cli serve --port 8443',
                    }
                    : null,
            });
            return true;
        }
        // ── GET /api/gateway/events/stream (SSE) ───────────────────────────────────
        if (pathname === '/api/gateway/events/stream' && method === 'GET') {
            const after = Number(parsedUrl.searchParams.get('after_sequence') || '0') || 0;
            try {
                const upstream = await client.openEventStream(after);
                if (!upstream.body) {
                    writeJson(res, 503, { error: 'Gateway event stream unavailable' });
                    return true;
                }
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                    'X-Accel-Buffering': 'no',
                });
                const reader = upstream.body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    res.write(decoder.decode(value, { stream: true }));
                }
                res.end();
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (!res.headersSent) {
                    writeJson(res, 503, { error: `Event stream failed: ${msg}` });
                }
                else {
                    res.end();
                }
            }
            return true;
        }
        // ── Unknown /api/gateway route ─────────────────────────────────────────────
        writeJson(res, 404, { error: `Gateway API route not found: ${pathname}` });
        return true;
    }
    catch (err) {
        if (err instanceof GatewayError) {
            writeJson(res, err.statusCode || 500, {
                error: err.message,
                code: err.code,
                details: err.details,
            });
            return true;
        }
        const msg = err instanceof Error ? err.message : String(err);
        writeJson(res, 500, { error: `Internal Gateway adapter error: ${msg}`, code: 'INTERNAL_GATEWAY_ERROR' });
        return true;
    }
}
//# sourceMappingURL=gateway-routes.js.map