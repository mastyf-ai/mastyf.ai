/**
 * Thin client: TS shield proxy → authoritative Python MastyfGateway arbiter.
 *
 * When MASTYF_AI_USE_GATEWAY_ARBITER is not "false" and a control token exists,
 * every post-policy gate consults /v1/decide so CBAC∩DIFC∩Workflow∩AIA is the
 * single root of trust. On transport failure: fail-closed ESCALATE (never ALLOW).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decideLatencyMs } from '../utils/metrics.js';
function controlBaseUrl() {
    return (process.env.MASTYF_GATEWAY_URL ||
        process.env.MASTYF_CONTROL_URL ||
        'http://127.0.0.1:8443').replace(/\/$/, '');
}
function readControlToken() {
    const env = process.env.MASTYF_CONTROL_TOKEN;
    if (env && env.trim())
        return env.trim();
    const home = process.env.MASTYF_HOME || join(homedir(), '.mastyf');
    const path = join(home, 'control_token');
    if (!existsSync(path))
        return null;
    try {
        return readFileSync(path, 'utf8').trim() || null;
    }
    catch {
        return null;
    }
}
export function isGatewayArbiterEnabled() {
    if (process.env.MASTYF_AI_USE_GATEWAY_ARBITER === 'false')
        return false;
    if (process.env.MASTYF_AI_USE_GATEWAY_ARBITER === 'true')
        return true;
    // Default on when a control token is present (gateway is the product)
    return Boolean(readControlToken());
}
const decideLatencyByRequestId = new Map();
export function rememberDecideLatencyMs(requestId, ms) {
    if (!requestId || !Number.isFinite(ms))
        return;
    decideLatencyByRequestId.set(requestId, ms);
    decideLatencyMs.observe(ms);
    if (decideLatencyByRequestId.size > 4000) {
        const first = decideLatencyByRequestId.keys().next().value;
        if (first)
            decideLatencyByRequestId.delete(first);
    }
}
export function takeDecideLatencyMs(requestId) {
    if (!requestId)
        return undefined;
    const v = decideLatencyByRequestId.get(requestId);
    if (v != null)
        decideLatencyByRequestId.delete(requestId);
    return v;
}
export async function decideViaGateway(input) {
    const token = readControlToken();
    if (!token) {
        return {
            available: false,
            finalDecision: 'ESCALATE',
            executionPermitted: false,
            reasonCode: 'GATEWAY_ARBITER_UNAVAILABLE',
            error: 'No control token',
        };
    }
    const body = {
        request_id: input.requestId || `ts-${randomUUID()}`,
        session_id: input.sessionId ||
            `${input.tenantId || 'default'}:${input.serverId || input.serverName || 'mcp-server'}`,
        principal_id: input.principalId || process.env.MASTYF_AI_PRINCIPAL_ID || 'mcp-client',
        user_intent: input.userIntent || `Execute tool ${input.toolName}`,
        tool_name: input.toolName,
        tool_args: input.toolArgs || {},
        retrieved_context: input.retrievedContext || 'None',
        server_id: input.serverId || input.serverName,
        server_name: input.serverName || input.serverId,
    };
    const controller = new AbortController();
    const timeoutMs = Number(process.env.MASTYF_GATEWAY_DECIDE_TIMEOUT_MS || 8000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${controlBaseUrl()}/v1/decide`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
            return {
                available: false,
                finalDecision: 'ESCALATE',
                executionPermitted: false,
                reasonCode: 'GATEWAY_ARBITER_HTTP_ERROR',
                error: `HTTP ${res.status}`,
            };
        }
        const data = (await res.json());
        const decideMs = typeof data.total_latency_ms === 'number' && Number.isFinite(data.total_latency_ms)
            ? Number(data.total_latency_ms)
            : undefined;
        if (decideMs != null)
            rememberDecideLatencyMs(body.request_id, decideMs);
        const final = String(data.final_decision || data.decision || 'ESCALATE').toUpperCase();
        const normalized = final === 'ALLOW' || final === 'BLOCK' || final === 'ESCALATE' ? final : 'ESCALATE';
        const permitted = data.execution_permitted === true ||
            (data.execution_permitted == null && normalized === 'ALLOW');
        // Fail-closed: never allow if response claims ALLOW but execution_permitted is false
        if (normalized === 'ALLOW' && data.execution_permitted === false) {
            return {
                available: true,
                finalDecision: 'ESCALATE',
                executionPermitted: false,
                reasonCode: String(data.reason_code || 'GATEWAY_INCONSISTENT_ALLOW'),
                raw: data,
            };
        }
        const bytesRaw = data.child_stdin_bytes ?? data.bytes_sent;
        const bytesSent = typeof bytesRaw === 'number'
            ? bytesRaw
            : normalized !== 'ALLOW' || !permitted
                ? 0
                : undefined;
        return {
            available: true,
            finalDecision: normalized,
            executionPermitted: permitted && normalized === 'ALLOW',
            reasonCode: String(data.reason_code || `ARBITER_${normalized}`),
            cbacDecision: data.cbac_decision != null ? String(data.cbac_decision) : undefined,
            difcDecision: data.difc_decision != null ? String(data.difc_decision) : undefined,
            aiaDecision: data.aia_decision != null ? String(data.aia_decision) : undefined,
            workflowDecision: data.workflow_decision != null ? String(data.workflow_decision) : undefined,
            policyHash: data.policy_hash != null ? String(data.policy_hash) : undefined,
            bytesSent,
            receiptId: data.receipt_id != null
                ? String(data.receipt_id)
                : data.request_id != null
                    ? String(data.request_id)
                    : body.request_id,
            executionObservation: data.execution_observation != null
                ? String(data.execution_observation)
                : permitted && normalized === 'ALLOW'
                    ? undefined
                    : 'NOT_SENT',
            totalLatencyMs: decideMs,
            raw: data,
        };
    }
    catch (err) {
        clearTimeout(timer);
        const msg = err instanceof Error ? err.message : String(err);
        return {
            available: false,
            finalDecision: 'ESCALATE',
            executionPermitted: false,
            reasonCode: 'GATEWAY_ARBITER_TIMEOUT_OR_ERROR',
            error: msg,
        };
    }
}
//# sourceMappingURL=gateway-arbiter-client.js.map