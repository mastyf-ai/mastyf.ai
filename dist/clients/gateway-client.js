/**
 * Canonical Mastyf Gateway Client for mastyf.ai
 *
 * Implements the authoritative integration boundary between mastyf.ai and Mastyf Gateway.
 * Key invariants:
 * 1. Authoritative Projection: mastyf.ai is a projection of Gateway truth, never an independent authority.
 * 2. Strict Schema Validation: All responses are strictly validated at runtime. Malformed or invalid
 *    payloads produce GATEWAY_STATE_UNAVAILABLE errors.
 * 3. Contract Versioning: Asserts compatible control_api_version ("1.0").
 * 4. Token Isolation: Reads local control token from ~/.mastyf/control_token (mode 0600) on the server side.
 * 5. Explicit Mutation Invariant: Mutating methods mandate confirmation: true to set X-Mastyf-Authorization.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const SUPPORTED_CONTROL_API_VERSION = '1.0';
export class GatewayError extends Error {
    code;
    statusCode;
    details;
    constructor(message, code = 'GATEWAY_ERROR', statusCode, details) {
        super(message);
        this.name = 'GatewayError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}
export class GatewayUnavailableError extends GatewayError {
    constructor(message = 'Gateway state unavailable', details) {
        super(message, 'GATEWAY_STATE_UNAVAILABLE', 503, details);
        this.name = 'GatewayUnavailableError';
    }
}
export class GatewayVersionMismatchError extends GatewayError {
    constructor(expected, actual) {
        super(`Incompatible Gateway Control API version: expected ${expected}, got ${actual}`, 'GATEWAY_VERSION_MISMATCH', 502);
        this.name = 'GatewayVersionMismatchError';
    }
}
// ── Strict Runtime Validators ───────────────────────────────────────────────────
function isObject(val) {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}
function validateGatewayStatus(data) {
    if (!isObject(data))
        throw new GatewayUnavailableError('Invalid status payload: expected object');
    if (typeof data['status'] !== 'string')
        throw new GatewayUnavailableError('Invalid status payload: missing status string');
    if (typeof data['control_api_version'] !== 'string') {
        throw new GatewayUnavailableError('Invalid status payload: missing control_api_version');
    }
    if (!isObject(data['policy']))
        throw new GatewayUnavailableError('Invalid status payload: missing policy');
    if (!isObject(data['ledger']))
        throw new GatewayUnavailableError('Invalid status payload: missing ledger');
    if (!isObject(data['intelligence']))
        throw new GatewayUnavailableError('Invalid status payload: missing intelligence');
    return data;
}
function validateProtectionReport(data) {
    if (!isObject(data))
        throw new GatewayUnavailableError('Invalid protection report: expected object');
    if (typeof data['result'] !== 'string')
        throw new GatewayUnavailableError('Invalid protection report: missing result');
    if (!Array.isArray(data['clients']))
        throw new GatewayUnavailableError('Invalid protection report: missing clients array');
    return data;
}
function validateDiscoveredServers(data) {
    const list = Array.isArray(data)
        ? data
        : isObject(data) && Array.isArray(data['servers'])
            ? data['servers']
            : null;
    if (!list) {
        throw new GatewayUnavailableError('Invalid servers list: expected array or { servers: [...] }');
    }
    for (const item of list) {
        if (!isObject(item) || typeof item['name'] !== 'string') {
            throw new GatewayUnavailableError('Invalid server entry in servers list');
        }
    }
    return list;
}
function validateProtectionPlan(data) {
    if (!isObject(data))
        throw new GatewayUnavailableError('Invalid protection plan: expected object');
    if (typeof data['plan_id'] !== 'string')
        throw new GatewayUnavailableError('Invalid plan: missing plan_id');
    if (typeof data['environment_generation'] !== 'number')
        throw new GatewayUnavailableError('Invalid plan: missing environment_generation');
    return data;
}
function validateApplyResult(data) {
    if (!isObject(data))
        throw new GatewayUnavailableError('Invalid apply result: expected object');
    if (typeof data['status'] !== 'string')
        throw new GatewayUnavailableError('Invalid apply result: missing status');
    return data;
}
function validateRollbackResult(data) {
    if (!isObject(data))
        throw new GatewayUnavailableError('Invalid rollback result: expected object');
    if (typeof data['status'] !== 'string')
        throw new GatewayUnavailableError('Invalid rollback result: missing status');
    return data;
}
export class MastyfGatewayClient {
    baseUrl;
    token;
    timeoutMs;
    constructor(config = {}) {
        const port = String(process.env['MASTYF_GATEWAY_PORT'] || '').trim();
        const fromPort = port ? `http://127.0.0.1:${port}` : 'http://127.0.0.1:8443';
        this.baseUrl = (config.baseUrl || process.env['MASTYF_GATEWAY_URL'] || fromPort).replace(/\/+$/, '');
        this.token = config.token || process.env['MASTYF_CONTROL_TOKEN'] || null;
        this.timeoutMs = config.timeoutMs || 8000;
    }
    /**
     * Lazily loads token from local ~/.mastyf/control_token file if not explicitly supplied.
     */
    getOrLoadToken() {
        if (this.token && this.token.trim().length > 0) {
            return this.token.trim();
        }
        const home = (process.env['MASTYF_HOME'] || '').trim() || join(homedir(), '.mastyf');
        const tokenPath = join(home, 'control_token');
        if (existsSync(tokenPath)) {
            try {
                const raw = readFileSync(tokenPath, 'utf-8').trim();
                if (raw.length > 0) {
                    this.token = raw;
                    return raw;
                }
            }
            catch (err) {
                throw new GatewayError(`Failed to read local control token from ${tokenPath}: ${err}`, 'TOKEN_READ_ERROR');
            }
        }
        throw new GatewayError('No Mastyf Gateway control token found. Ensure Mastyf Gateway is running.', 'TOKEN_MISSING');
    }
    async request(endpoint, options = {}) {
        const token = this.getOrLoadToken();
        const url = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        if (options.confirmation) {
            headers['X-Mastyf-Authorization'] = 'confirmed';
        }
        const controller = new AbortController();
        const timeout = options.timeoutMs ?? this.timeoutMs;
        const timer = setTimeout(() => controller.abort(), timeout);
        let res;
        try {
            res = await fetch(url, {
                method: options.method || 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: controller.signal,
            });
        }
        catch (err) {
            clearTimeout(timer);
            const msg = err instanceof Error ? err.message : String(err);
            throw new GatewayUnavailableError(`Connection to Mastyf Gateway at ${this.baseUrl} failed: ${msg}`);
        }
        finally {
            clearTimeout(timer);
        }
        let payload;
        try {
            payload = await res.json();
        }
        catch {
            throw new GatewayUnavailableError(`Gateway returned non-JSON response from ${endpoint} (HTTP ${res.status})`);
        }
        if (!res.ok) {
            const errDetail = isObject(payload) && typeof payload['detail'] === 'string'
                ? payload['detail']
                : `HTTP ${res.status}`;
            throw new GatewayError(`Gateway error (${res.status}): ${errDetail}`, 'GATEWAY_HTTP_ERROR', res.status, payload);
        }
        return payload;
    }
    // ── Public API Methods ────────────────────────────────────────────────────────
    /**
     * Fetches authoritative Gateway environment status, validating contract version.
     */
    async status() {
        const data = await this.request('/v1/status');
        const validated = validateGatewayStatus(data);
        if (validated.control_api_version !== SUPPORTED_CONTROL_API_VERSION) {
            throw new GatewayVersionMismatchError(SUPPORTED_CONTROL_API_VERSION, validated.control_api_version);
        }
        return validated;
    }
    /**
     * Fetches canonical ProtectionVerificationReport across all client environments.
     */
    async protection() {
        const data = await this.request('/v1/protection');
        return validateProtectionReport(data);
    }
    /**
     * Returns discovered MCP servers and classified tools.
     */
    async servers() {
        const data = await this.request('/v1/servers');
        return validateDiscoveredServers(data);
    }
    /**
     * Per-MCP allow/block/escalate aggregates from the execution ledger.
     */
    async serverStats() {
        return this.request('/v1/servers/stats');
    }
    /**
     * Paginated receipts for one MCP server identity.
     */
    async serverReceipts(serverId, options = {}) {
        const params = new URLSearchParams();
        if (options.limit)
            params.set('limit', String(options.limit));
        if (options.offset != null)
            params.set('offset', String(options.offset));
        const qs = params.toString();
        return this.request(`/v1/servers/${encodeURIComponent(serverId)}/receipts${qs ? `?${qs}` : ''}`);
    }
    /**
     * Posture summary for one MCP server (discovery + live telemetry).
     */
    async serverPosture(serverId) {
        return this.request(`/v1/servers/${encodeURIComponent(serverId)}/posture`);
    }
    /**
     * Returns active policy details and validation.
     */
    async policy() {
        return this.request('/v1/policy');
    }
    /**
     * Fetches execution receipts audit log.
     */
    async receipts(options = {}) {
        const params = new URLSearchParams();
        if (options.limit)
            params.set('limit', String(options.limit));
        if (options.offset != null)
            params.set('offset', String(options.offset));
        if (options.cursor)
            params.set('cursor', options.cursor);
        if (options.serverId)
            params.set('server_id', options.serverId);
        if (options.serverName)
            params.set('server_name', options.serverName);
        const qs = params.toString();
        return this.request(`/v1/receipts${qs ? `?${qs}` : ''}`);
    }
    /**
     * Time-window decision aggregates from the live execution ledger.
     */
    async receiptStats(options = {}) {
        const params = new URLSearchParams();
        if (options.window)
            params.set('window', options.window);
        if (options.since)
            params.set('since', options.since);
        if (options.until)
            params.set('until', options.until);
        const qs = params.toString();
        return this.request(`/v1/receipts/stats${qs ? `?${qs}` : ''}`);
    }
    /**
     * Fetches control receipts audit log.
     */
    async controlReceipts(options = {}) {
        const params = new URLSearchParams();
        if (options.limit)
            params.set('limit', String(options.limit));
        if (options.offset != null)
            params.set('offset', String(options.offset));
        if (options.cursor)
            params.set('cursor', options.cursor);
        const qs = params.toString();
        return this.request(`/v1/control-receipts${qs ? `?${qs}` : ''}`);
    }
    /**
     * Pre-flights a typed and fingerprinted ProtectionPlan without mutating configuration.
     */
    async protectionPlan(request = {}) {
        const data = await this.request('/v1/protection/plan', {
            method: 'POST',
            body: { server_names: request.serverNames },
        });
        return validateProtectionPlan(data);
    }
    /**
     * Atomically executes a previously planned ProtectionPlan.
     * Mandates explicit confirmation boolean.
     */
    async protectionApply(plan, confirmation) {
        if (confirmation !== true) {
            throw new GatewayError('Protection apply requires explicit confirmation: true', 'CONFIRMATION_REQUIRED');
        }
        const data = await this.request('/v1/protection/apply', {
            method: 'POST',
            body: { plan },
            confirmation: true,
        });
        return validateApplyResult(data);
    }
    /**
     * Rolls back configuration to a previous snapshot generation.
     * Mandates explicit confirmation boolean.
     */
    async rollback(targetGeneration, confirmation = false) {
        if (confirmation !== true) {
            throw new GatewayError('Rollback requires explicit confirmation: true', 'CONFIRMATION_REQUIRED');
        }
        const data = await this.request('/v1/protection/rollback', {
            method: 'POST',
            body: { target_generation: targetGeneration },
            confirmation: true,
        });
        return validateRollbackResult(data);
    }
    /**
     * Proposes policy modifications using the PolicyAssistant without activating them.
     */
    async policyPropose(intent) {
        return this.request('/v1/policy/propose', {
            method: 'POST',
            body: { intent },
        });
    }
    /**
     * Activates a validated policy YAML.
     * Mandates explicit confirmation boolean.
     */
    async policyActivate(policyYaml, confirmation) {
        if (confirmation !== true) {
            throw new GatewayError('Policy activation requires explicit confirmation: true', 'CONFIRMATION_REQUIRED');
        }
        return this.request('/v1/policy/activate', {
            method: 'POST',
            body: { policy_yaml: policyYaml },
            confirmation: true,
        });
    }
    /**
     * Executes static and dynamic analysis scan on MCP servers.
     */
    async scan(serverNames) {
        return this.request('/v1/scan', {
            method: 'POST',
            body: { server_names: serverNames },
        });
    }
    /**
     * Explains the deterministic and intelligence factors for a specific decision.
     */
    async explainDecision(receiptId) {
        return this.request('/v1/explain/decision', {
            method: 'POST',
            body: { receipt_id: receiptId },
        });
    }
    /** Immutable deployment artifact identity from the control plane. */
    async deploymentManifest() {
        return this.request('/v1/deployment-manifest');
    }
    /** Live canary self-test (can take >8s — uses extended timeout). */
    async selfTest(body = {}) {
        return this.request('/v1/self-test', { method: 'POST', body, timeoutMs: 180_000 });
    }
    /** Open SSE event stream against the control plane (server-side only). */
    async openEventStream(afterSequence = 0) {
        const token = this.getOrLoadToken();
        const url = `${this.baseUrl}/v1/events/stream?after_sequence=${afterSequence}`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'text/event-stream',
            },
        });
        if (!res.ok) {
            throw new GatewayError(`Event stream failed (${res.status})`, 'GATEWAY_HTTP_ERROR', res.status);
        }
        return res;
    }
    /** Open / resolved escalation queue. */
    async escalations(status = 'open') {
        const qs = new URLSearchParams({ status });
        return this.request(`/v1/escalations?${qs.toString()}`);
    }
    /**
     * Resolve an escalated receipt with OS4 approval grammar.
     * Actions: allow_once | session | similar | destination | tool | block | quarantine
     * (aliases: allow, allow_similar). Always finite expires_at.
     */
    async resolveEscalation(request) {
        return this.request('/v1/escalation/resolve', {
            method: 'POST',
            body: {
                receipt_id: request.receiptId,
                action: request.action,
                confirmation: request.confirmation,
                remaining_uses: request.remainingUses,
                ttl_seconds: request.ttlSeconds,
                expires_at: request.expiresAt,
                scope_details: request.scopeDetails,
                destination: request.destination,
                session_id: request.sessionId,
                operator: request.operator,
            },
            confirmation: true,
        });
    }
    /** Active lockdown / safe-mode / kill controls. */
    async lockdownState() {
        return this.request('/v1/lockdown');
    }
    async lockdownApply(body) {
        return this.request('/v1/lockdown/apply', {
            method: 'POST',
            body: {
                mode: body.mode,
                scope: body.scope,
                target: body.target,
                reason: body.reason,
                ttl_seconds: body.ttlSeconds,
                expires_at: body.expiresAt,
                operator: body.operator,
                confirmation: true,
            },
            confirmation: true,
        });
    }
    async lockdownRelease(controlId, operator) {
        return this.request('/v1/lockdown/release', {
            method: 'POST',
            body: { control_id: controlId, confirmation: true, operator },
            confirmation: true,
        });
    }
    async continuousVerification() {
        return this.request('/v1/verification');
    }
    async driftClasses() {
        return this.request('/v1/drift');
    }
    async activityTimeline(limit = 100) {
        return this.request(`/v1/activity-timeline?limit=${limit}`);
    }
    async operatorGrants(limit = 100) {
        return this.request(`/v1/operator-grants?limit=${limit}`);
    }
    async toolPins() {
        return this.request('/v1/tool-pin');
    }
    async checkToolPin(serverId, tools) {
        return this.request('/v1/tool-pin/check', {
            method: 'POST',
            body: { server_id: serverId, tools },
        });
    }
    async attackLabOwasp() {
        return this.request('/v1/attack-lab/owasp-mcp');
    }
    async sandboxObserveStatus() {
        return this.request('/v1/sandbox/observe-status');
    }
    /** Authoritative dry-run / evaluate decide path. */
    async decide(body) {
        return this.request('/v1/decide', { method: 'POST', body });
    }
    /** Single receipt by id. */
    async receiptById(receiptId) {
        return this.request(`/v1/receipts/${encodeURIComponent(receiptId)}`);
    }
    /** Full action trace for a receipt when available. */
    async receiptTrace(receiptId) {
        return this.request(`/v1/receipts/${encodeURIComponent(receiptId)}/trace`);
    }
    /** Conversational agent turn mediated by Mastyf Gateway. */
    async agentChat(body) {
        return this.request('/v1/agent/chat', {
            method: 'POST',
            body: {
                message: body.message,
                session_id: body.sessionId,
                principal_id: body.principalId,
                mock: body.mock,
            },
        });
    }
}
//# sourceMappingURL=gateway-client.js.map