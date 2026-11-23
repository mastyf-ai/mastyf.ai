/**
 * Machine-readable enforcement contract for the Agent Gateway authorizer.
 *
 * ## Why this module exists
 *
 * The authorizer runs the *same* `evaluateToolCallDefense` pipeline as the local
 * proxies, which makes it look like full Shield Desktop parity. It is not, and
 * the difference is invisible from the outside: a strategy whose container,
 * identity, or shared state is missing returns `null`, and `null` means "no
 * verdict, keep going". Several of those strategies therefore do nothing at all
 * in this deployment while every log line still reads like a healthy
 * authorization.
 *
 * That is the same failure shape as fabricating a metric -- the system reports
 * work it did not do. So instead of asserting parity, this module reports what is
 * actually live, and `index.ts` refuses to serve when a required capability is
 * missing instead of quietly degrading.
 *
 * ## The three-way contract
 *
 * `enforcement` records *where* a control can legitimately run, which is the
 * honest replacement for a parity claim:
 *
 * - `gateway`   -- decided here, on this request.
 * - `upstream`  -- decided by Agent Identity + IAP IAM Unified Access Policies
 *                  before the request reaches this service. Not re-checked here
 *                  because the extension cannot observe the identity.
 * - `desktop-only` -- structurally impossible at an egress authorizer.
 *
 * ## Invariants
 *
 *  1. Every capability carries a non-empty `detail`. A `live` state with no
 *     reason is indistinguishable from a guess, which is what this module exists
 *     to prevent.
 *  2. `state` is derived from real runtime state (`isAgenticEnabled()`,
 *     `isRedisConfigured()`, `OPA_URL`, `MASTYF_AI_STRICT_MODE`), never from
 *     operator intent.
 *  3. Nothing here changes a verdict. It reports. Enforcement stays in the
 *     policy engine and the fail-closed paths in `decision-core.ts`.
 */
import { isAgenticEnabled } from '../utils/agentic-container.js';
import { isRedisConfigured, getRedisConnectionLabel } from '../utils/redis-client.js';
import { resolveMastyfAiDbPath } from '../utils/mastyf-ai-db-path.js';
import { getIndustryHotState } from '../database/industry-hot-state.js';
/**
 * The eight per-call content controls.
 *
 * These are pure functions of `(toolName, arguments)` and run on the full
 * `evaluateAsync` path, so they need no container, identity, or shared state.
 * This is the part of the surface that genuinely matches the local proxy.
 */
const CONTENT_CONTROL_IDS = [
    'tool-deny',
    'secrets-in-args',
    'request-prompt-injection',
    'encoding-guard',
    'resource-guard',
    'semantic-guards',
    'language-gadget',
    'tool-definition',
];
export const AUTHORIZED_MCP_METHODS = ['tools/call'];
export const DENIED_MCP_METHODS = [
    'unrecognised-payload',
    'unauthorised-method',
    'empty-payload',
    'payload-too-large',
    'arguments-too-large-for-authorization',
    'unserialisable-arguments',
    'fail-closed-invariant',
];
export const UNAUTHORIZED_MCP_METHODS = [
    'initialize',
    'ping',
    'tools/list',
    'prompts/get',
    'prompts/list',
    'resources/read',
    'resources/list',
    'resources/subscribe',
    'completion/complete',
    'logging/setLevel',
    'notifications/*',
];
/** Builds the protocol half of the report. */
export function buildProtocolCoverage() {
    return {
        authorized: [...AUTHORIZED_MCP_METHODS],
        denied: [...DENIED_MCP_METHODS],
        unauthorized: [...UNAUTHORIZED_MCP_METHODS],
        nonMcpTraffic: 'Not authorized by this service. Non-MCP HTTP and any LLM-provider traffic bypasses it entirely.',
    };
}
function strictModeEnabled() {
    return process.env['MASTYF_AI_STRICT_MODE'] === 'true';
}
/**
 * Can the active database backend actually persist agentic state?
 *
 * `IndustryStandardStore` reaches the database through `db.prepare()` with
 * SQLite-only SQL (`INSERT OR REPLACE`, named `@params`, sync run/get/all).
 * `PostgresDatabase` exposes an async pg Pool and no `prepare()`, so `prep()`
 * returns null and every certification / biometric / reputation / zero-trust
 * read and write is silently discarded -- no throw, no warning, empty result.
 * Verified against PostgresDatabase directly; do not "fix" this by reporting
 * `live` just because a container object exists.
 */
function agenticStateBackend() {
    const dbType = (process.env['DB_TYPE'] || 'sqlite').toLowerCase();
    if (dbType === 'postgres') {
        // PostgreSQL is only usable for the enforcement path once the hot-state
        // cache has actually loaded: the synchronous IndustryStandardStore reads
        // still cannot talk to Postgres directly. Until hydration succeeds they
        // return null, which the strategies read as "not certified".
        const hot = getIndustryHotState();
        if (!hot.enabled) {
            return {
                durable: false,
                reason: 'DB_TYPE=postgres without an agentic hot-state backend attached; IndustryStandardStore cannot use the better-sqlite3 prepare() API so every agentic-state read returns null',
            };
        }
        if (!hot.hydrated) {
            return {
                durable: false,
                reason: 'DB_TYPE=postgres with a hot-state backend attached but not yet hydrated; agentic-state reads would return null and deny all MCP traffic',
            };
        }
        if (hot.lastErrorMessage) {
            return {
                durable: false,
                reason: `DB_TYPE=postgres hot-state cache is serving a stale snapshot after a failed refresh (${hot.lastErrorMessage})`,
            };
        }
        const stats = hot.stats();
        return {
            durable: true,
            reason: `PostgreSQL via the industry hot-state cache (${stats.dialect}); ` +
                `certification=${stats.rowCounts.mcp_certifications ?? 0}, ` +
                `fingerprints=${stats.rowCounts.behavior_fingerprints ?? 0}, ` +
                `intent=${stats.rowCounts.intent_bindings ?? 0}, ` +
                `reputation=${stats.rowCounts.agent_reputation ?? 0}, ` +
                `sandbox=${stats.rowCounts.sandbox_tier_state ?? 0}`,
        };
    }
    if (resolveMastyfAiDbPath() === ':memory:') {
        return { durable: false, reason: 'MASTYF_AI_DB_PATH is :memory:' };
    }
    // Cloud Run gives only an ephemeral writable filesystem, so a cold start
    // silently loses all certification, biometric, and reputation history.
    const onCloudRun = !!process.env['K_CONFIGURATION'];
    const assertedDurable = process.env['MASTYF_AI_AGENTIC_STATE_DURABLE'] === 'true';
    if (onCloudRun && !assertedDurable) {
        return {
            durable: false,
            reason: 'SQLite on an ephemeral filesystem (Cloud Run); state vanishes on every cold start. Set MASTYF_AI_AGENTIC_STATE_DURABLE=true only when MASTYF_AI_DB_PATH is on a persistent volume',
        };
    }
    return { durable: true, reason: 'SQLite on a persistent path' };
}
function agenticState() {
    if (process.env['MASTYF_AI_AGENTIC_ENABLED'] === 'false') {
        return {
            state: 'unavailable',
            detail: 'MASTYF_AI_AGENTIC_ENABLED=false; agentic strategies are skipped by explicit operator choice',
        };
    }
    const backend = agenticStateBackend();
    if (!isAgenticEnabled()) {
        return {
            state: 'unavailable',
            detail: 'No agentic container. certification, behavioral-biometrics, zero-trust, and the agentic pre-guard hooks all return null and are silently skipped',
        };
    }
    if (!backend.durable) {
        return {
            state: 'degraded',
            detail: `Agentic container initialized, but its state is not durably stored (${backend.reason}). Certification, behavioral-biometrics, and zero-trust compute in-process but do not persist or share across replicas/restarts`,
        };
    }
    return {
        state: 'live',
        detail: `Agentic container initialized with durable state (${backend.reason}); certification, biometrics, and zero-trust are reading real state`,
    };
}
function redisState() {
    if (isRedisConfigured()) {
        return {
            state: 'live',
            detail: `Shared state via Redis (${getRedisConnectionLabel()}); limits and flow history are global across replicas`,
        };
    }
    return {
        state: 'degraded',
        detail: 'No Redis. session-flow, timing-guard, and idempotency fall back to per-process LRU caches, so limits and loop detection see only this replica\'s traffic',
    };
}
function opaState() {
    const url = process.env['OPA_URL'];
    if (!url) {
        return { state: 'degraded', detail: 'OPA_URL is unset; the OPA strategy is disabled and no OPA rule is evaluated' };
    }
    return strictModeEnabled()
        ? { state: 'live', detail: `OPA configured at ${url}; an unreachable OPA fails closed under strict mode` }
        : {
            state: 'degraded',
            detail: `OPA configured at ${url} but MASTYF_AI_STRICT_MODE is not 'true'; an unreachable or malformed OPA response fails OPEN and authorizes`,
        };
}
function redisRateLimitState() {
    if (!isRedisConfigured()) {
        return {
            state: 'degraded',
            detail: 'No Redis; the Redis rate limiter is bypassed and in-process counters are used per replica',
        };
    }
    return strictModeEnabled()
        ? { state: 'live', detail: 'Redis rate limiter active and failing closed under strict mode' }
        : {
            state: 'degraded',
            detail: 'Redis rate limiter active, but MASTYF_AI_STRICT_MODE is not \'true\'; a Redis fault falls back to per-process counters instead of refusing',
        };
}
/**
 * Per-user tool policy. This is the sharpest example of a silent no-op: the
 * engine calls it on every request, and it returns `null` before checking
 * anything when there is no identity, so the log shows a strategy that ran.
 */
function userToolEnforcementState() {
    return {
        state: 'unavailable',
        detail: 'Requires agent identity, which the CONTENT_AUTHZ extension does not receive. Every per-user tool, path, and token rule is skipped rather than denied',
    };
}
function rbacState() {
    return {
        state: 'degraded',
        detail: 'YAML rbac rules fail closed when identity is absent, so they refuse rather than skip -- but with no identity they cannot grant, making every rbac rule a blanket deny',
    };
}
/**
 * Request-token accounting.
 *
 * `requestTokens` is estimated from the received body, not tokenized. It is a
 * guard input only (per-rule `maxTokens`, per-user token budgets, loop burn-rate)
 * and is deliberately never used for cost accounting -- billing uses the real
 * tokenizer in the proxy's cost phase, so no estimated figure can reach an
 * invoice.
 */
function requestTokensState(mode) {
    if (mode === 'zeroed') {
        return {
            state: 'unavailable',
            detail: 'requestTokens is pinned to 0, which disables maxTokens rules, per-user token budgets, and loop burn-rate detection without any signal that they were skipped',
        };
    }
    return {
        state: 'degraded',
        detail: 'Estimated from received body bytes, not tokenized. Adequate for guard thresholds; never used for cost accounting',
    };
}
/**
 * Assembles the full report from live runtime state.
 *
 * Deliberately a pure function of the environment and container so the
 * conformance harness can assert on it without a socket.
 */
export function buildCapabilityReport(options) {
    const agentic = agenticState();
    const redis = redisState();
    const opa = opaState();
    const rateLimit = redisRateLimitState();
    const userTools = userToolEnforcementState();
    const rbac = rbacState();
    const tokens = requestTokensState(options.requestTokensMode);
    const capabilities = [
        ...CONTENT_CONTROL_IDS.map((id) => ({
            id,
            state: 'live',
            enforcement: 'gateway',
            detail: 'Pure per-call control on the full evaluateAsync path; no container, identity, or shared state required',
        })),
        {
            id: 'mcp-certification',
            state: agentic.state,
            enforcement: 'gateway',
            detail: agentic.detail,
        },
        {
            id: 'behavioral-biometrics',
            state: agentic.state,
            enforcement: 'gateway',
            detail: agentic.detail,
        },
        {
            id: 'zero-trust',
            state: agentic.state,
            enforcement: 'gateway',
            detail: agentic.detail,
        },
        {
            id: 'agentic-pre-guard-hooks',
            state: agentic.state,
            enforcement: 'gateway',
            detail: agentic.detail,
        },
        { id: 'user-tool-enforcement', state: userTools.state, enforcement: 'gateway', detail: userTools.detail },
        { id: 'yaml-rbac', state: rbac.state, enforcement: 'gateway', detail: rbac.detail },
        { id: 'request-tokens', state: tokens.state, enforcement: 'gateway', detail: tokens.detail },
        { id: 'session-flow', state: redis.state, enforcement: 'gateway', detail: redis.detail },
        { id: 'timing-guard', state: redis.state, enforcement: 'gateway', detail: redis.detail },
        { id: 'idempotency', state: redis.state, enforcement: 'gateway', detail: redis.detail },
        { id: 'redis-rate-limit', state: rateLimit.state, enforcement: 'gateway', detail: rateLimit.detail },
        { id: 'opa', state: opa.state, enforcement: 'gateway', detail: opa.detail },
        {
            id: 'agent-identity',
            state: 'live',
            enforcement: 'upstream',
            detail: 'Agent Identity + IAP IAM Unified Access Policies decide which agent may connect. Unidentified agents are refused before a request reaches this service, so it is not re-checked here',
        },
        {
            id: 'argument-size-ceiling',
            state: 'degraded',
            enforcement: 'gateway',
            detail: 'Arguments above the scan cap are refused, not truncated. A legitimate large write is denied rather than partially inspected',
        },
        {
            id: 'local-approval-ui',
            state: 'unavailable',
            enforcement: 'desktop-only',
            detail: 'Interactive approve/deny prompts are a local desktop surface; an egress authorizer has no user to prompt',
        },
        {
            id: 'stdio-sse-websocket-transports',
            state: 'unavailable',
            enforcement: 'desktop-only',
            detail: 'The gateway observes one HTTPS MCP hop. Local stdio, SSE, and WebSocket interception has no analogue here',
        },
        {
            id: 'mtls-client-identity',
            state: 'unavailable',
            enforcement: 'desktop-only',
            detail: 'The gateway terminates mTLS, so client-certificate SPIFFE attributes are not a reliable extension input',
        },
    ];
    return { protocol: buildProtocolCoverage(), capabilities };
}
/** Ids that must be `live` for the authorizer to be considered fully operational. */
export const REQUIRED_LIVE_CAPABILITIES = ['mcp-certification', 'behavioral-biometrics', 'zero-trust'];
/**
 * Returns the required capabilities that are not live.
 *
 * Used to refuse startup. A security authorizer that boots with its primary
 * strategies silently disabled is worse than one that does not boot, because
 * the refusal is visible and the degradation is not.
 */
export function findMissingRequired(report, required = REQUIRED_LIVE_CAPABILITIES) {
    const byId = new Map(report.capabilities.map((c) => [c.id, c]));
    const missing = [];
    for (const id of required) {
        const cap = byId.get(id);
        if (!cap) {
            missing.push({ id, detail: 'Capability is not present in the report at all' });
            continue;
        }
        if (cap.state !== 'live') {
            missing.push({ id, detail: cap.detail });
        }
    }
    return missing;
}
/** Renders the report as aligned text for startup logs. */
export function formatCapabilityReport(report) {
    const lines = [];
    lines.push('[agent-gateway] Enforcement contract');
    lines.push(`  authorized:  ${report.protocol.authorized.join(', ')}` +
        `\n  denied:      ${report.protocol.denied.join(', ')}` +
        `\n  unauthorized (never reach this service, no verdict): ${report.protocol.unauthorized.join(', ')}` +
        `\n  non-MCP:     ${report.protocol.nonMcpTraffic}`);
    const byPoint = new Map();
    for (const cap of report.capabilities) {
        const list = byPoint.get(cap.enforcement) ?? [];
        list.push(cap);
        byPoint.set(cap.enforcement, list);
    }
    for (const point of ['gateway', 'upstream', 'desktop-only']) {
        const caps = byPoint.get(point) ?? [];
        if (caps.length === 0)
            continue;
        lines.push(`  [${point}]`);
        for (const cap of caps) {
            lines.push(`    ${cap.state.padEnd(11)} ${cap.id}`);
        }
    }
    const degraded = report.capabilities.filter((c) => c.state !== 'live');
    lines.push(`  ${report.capabilities.length} capabilities, ${report.capabilities.length - degraded.length} live, ${degraded.length} degraded or unavailable`);
    return lines.join('\n');
}
// ─── Machine-readable artifact + drift detection ───────────────────────────
export const CAPABILITY_ARTIFACT_SCHEMA_VERSION = 1;
/**
 * Deterministic, diff-stable projection of the report. Intentionally carries no
 * timestamp, hostname, or PID: the point is to commit this file and diff it
 * across builds, so anything that varies per run would guarantee false drift.
 */
export function buildCapabilityArtifact(report) {
    return {
        schemaVersion: CAPABILITY_ARTIFACT_SCHEMA_VERSION,
        protocol: report.protocol,
        capabilities: [...report.capabilities].sort((a, b) => a.id.localeCompare(b.id)),
    };
}
/**
 * Compares a committed baseline against a live report and returns human-readable
 * drift lines (empty when they agree).
 *
 * Only `state` and `enforcement` are compared. `detail` is deliberately
 * excluded: it is explanatory prose that gets reworded freely, and failing a
 * deploy because someone rewrote a sentence would train operators to ignore the
 * gate. The state is the security-relevant fact -- `live` versus `degraded` is
 * the difference between an enforced control and a silent no-op.
 */
export function diffCapabilityArtifact(baseline, report) {
    const drift = [];
    if (baseline.schemaVersion !== CAPABILITY_ARTIFACT_SCHEMA_VERSION) {
        drift.push(`schemaVersion ${baseline.schemaVersion} -> ${CAPABILITY_ARTIFACT_SCHEMA_VERSION} (regenerate the baseline)`);
    }
    const current = new Map(report.capabilities.map((c) => [c.id, c]));
    const baselineIds = new Set(baseline.capabilities.map((c) => c.id));
    for (const cap of baseline.capabilities) {
        if (!current.has(cap.id))
            drift.push(`${cap.id}: removed from the report`);
    }
    for (const cap of report.capabilities) {
        const was = baseline.capabilities.find((c) => c.id === cap.id);
        if (!was) {
            if (!baselineIds.has(cap.id))
                drift.push(`${cap.id}: added (${cap.state})`);
            continue;
        }
        if (was.state !== cap.state) {
            drift.push(`${cap.id}: ${was.state} -> ${cap.state}${cap.state !== 'live' ? ` -- ${cap.detail}` : ''}`);
        }
        else if (was.enforcement !== cap.enforcement) {
            drift.push(`${cap.id}: enforcement ${was.enforcement} -> ${cap.enforcement}`);
        }
    }
    return drift;
}
//# sourceMappingURL=capabilities.js.map