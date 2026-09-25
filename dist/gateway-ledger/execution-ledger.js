/**
 * Gateway execution-receipt ledger.
 *
 * Appends tamper-evident, hash-chained receipts to receipts.jsonl in a format
 * that is byte-compatible with the Python mastyf_gateway ExecutionReceiptLedger
 * (~/.mastyf/receipts.jsonl). The live shield proxy mints these receipts for
 * every mediated tool call, so the gateway control API (:8443 /v1/receipts) and
 * the security center read real, live traffic — replacing the synthetic
 * receipts that were previously minted only by the Python demo / inline
 * MCPStdioProxy.
 *
 * Canonical-serialization details mirror mastyf_gateway/receipts/canonical.py:
 *   - JSON keys sorted lexicographically (recursively)
 *   - compact separators (",", ":")
 *   - non-ASCII characters kept as-is (JSON.stringify never escapes them)
 *   - SHA-256 over the UTF-8 bytes
 */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync, } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { takeDecideLatencyMs } from './gateway-arbiter-client.js';
export const GENESIS_PREVIOUS_HASH = '0'.repeat(64);
export const LEDGER_SCHEMA_V1 = 1;
export const LEDGER_SCHEMA_V2 = 2;
export const LEDGER_SCHEMA_V3 = 3;
export const LEDGER_SCHEMA_V4 = 4;
export const LEDGER_SCHEMA = LEDGER_SCHEMA_V2;
const SCHEMA_V2_IDENTITY_FIELDS = [
    'server_id',
    'server_name',
    'client_name',
    'command_digest',
    'child_stdin_bytes',
];
const SCHEMA_V3_TRACE_FIELDS = [
    'workflow_decision',
    'cbac_latency_ms',
    'difc_latency_ms',
    'workflow_latency_ms',
    'aia_latency_ms',
    'total_latency_ms',
    'aia_engine',
    'aia_model',
    'aia_invariant_violation',
];
const SCHEMA_V4_RESPONSE_FIELDS = [
    'response_firewall_decision',
    'response_firewall_action',
    'response_firewall_reason',
    'response_secrets_redacted_count',
];
/** Recursively sorts object keys to match Python's json.dumps(sort_keys=True). */
function sortKeys(value) {
    if (Array.isArray(value))
        return value.map(sortKeys);
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = sortKeys(value[key]);
        }
        return out;
    }
    return value;
}
/** Python stores these as float(); json.dumps(14.0) emits 14.0, JSON.stringify emits 14. */
const PYTHON_FLOAT_HASH_FIELDS = new Set([
    'cbac_latency_ms',
    'difc_latency_ms',
    'workflow_latency_ms',
    'aia_latency_ms',
    'total_latency_ms',
]);
function stringifyCanonical(value, key) {
    if (value === null)
        return 'null';
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number') {
        if (key &&
            PYTHON_FLOAT_HASH_FIELDS.has(key) &&
            Number.isFinite(value) &&
            Number.isInteger(value)) {
            return `${value}.0`;
        }
        return JSON.stringify(value);
    }
    if (typeof value === 'string')
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => stringifyCanonical(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const obj = value;
        const keys = Object.keys(obj);
        return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifyCanonical(obj[k], k)}`).join(',')}}`;
    }
    return 'null';
}
/** Deterministic compact JSON with recursively sorted keys (canonical_json). */
export function canonicalJson(value) {
    return stringifyCanonical(sortKeys(value));
}
/** SHA-256 hex digest over canonical UTF-8 JSON bytes. */
export function canonicalHash(value) {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
/** Deterministic hash for tool arguments (canonical_hash of the args object). */
export function hashArguments(args) {
    return canonicalHash(args ?? {});
}
function defaultLedgerPath() {
    const home = process.env.MASTYF_HOME || join(homedir(), '.mastyf');
    return process.env.MASTYF_AI_RECEIPT_LEDGER_PATH || join(home, 'receipts.jsonl');
}
export class GatewayLedgerError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GatewayLedgerError';
    }
}
export class ExecutionReceiptLedger {
    path;
    nextSequenceId = 0;
    lastReceiptHash = GENESIS_PREVIOUS_HASH;
    corrupted = false;
    corruptionDetail;
    writeChain = Promise.resolve();
    constructor(ledgerPath) {
        this.path = ledgerPath || defaultLedgerPath();
        mkdirSync(dirname(this.path), { recursive: true });
        this.recover();
    }
    get isCorrupted() {
        return this.corrupted;
    }
    get corruptionReason() {
        return this.corruptionDetail;
    }
    get nextSequence() {
        return this.nextSequenceId;
    }
    get lastHash() {
        return this.lastReceiptHash;
    }
    /** Deterministic dict used for the receipt hash (mirrors to_canonical_dict). */
    canonicalDict(receipt) {
        const schema = typeof receipt['schema'] === 'number' ? receipt['schema'] : LEDGER_SCHEMA_V1;
        const core = {};
        for (const [k, v] of Object.entries(receipt)) {
            if (k === 'receipt_hash')
                continue;
            // Observability join key — never part of authority hash (parity with Python).
            if (k === 'trace_id')
                continue;
            if (k === 'workflow_id' && v == null)
                continue;
            if (k === 'workflow_id' ||
                k === 'workflow_state_before' ||
                k === 'workflow_transition' ||
                k === 'workflow_state_after' ||
                k === 'workflow_rule' ||
                k === 'execution_certainty') {
                // When workflow_id is absent, the Python to_canonical_dict pops every workflow field.
                if (receipt['workflow_id'] == null)
                    continue;
            }
            if (SCHEMA_V2_IDENTITY_FIELDS.includes(k)) {
                if (schema < LEDGER_SCHEMA_V2)
                    continue;
                if (v == null)
                    continue;
            }
            if (SCHEMA_V3_TRACE_FIELDS.includes(k)) {
                if (schema < LEDGER_SCHEMA_V3)
                    continue;
                if (v == null)
                    continue;
            }
            if (SCHEMA_V4_RESPONSE_FIELDS.includes(k)) {
                if (schema < LEDGER_SCHEMA_V4)
                    continue;
                if (v == null)
                    continue;
            }
            core[k] = v;
        }
        return core;
    }
    hashOf(receipt) {
        return canonicalHash(this.canonicalDict(receipt));
    }
    markCorrupt(detail) {
        this.corrupted = true;
        this.corruptionDetail = detail;
    }
    /**
     * Recovers head sequence ID and receipt hash on startup, validating the whole
     * chain. Fails closed on malformed JSON, sequence gaps, hash mismatches, or
     * security-invariant violations — matching the Python ledger's fail-closed
     * recovery.
     */
    recover() {
        if (!existsSync(this.path))
            return;
        const stat = statSync(this.path);
        if (stat.size === 0)
            return;
        const content = readFileSync(this.path, 'utf8');
        let expectedSeq = 0;
        let expectedPrev = GENESIS_PREVIOUS_HASH;
        let headHash = '';
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (!line)
                continue;
            let data;
            try {
                data = JSON.parse(line);
            }
            catch {
                this.markCorrupt(`line ${expectedSeq}: malformed JSON`);
                return;
            }
            if (typeof data.sequence_id !== 'number' || data.sequence_id !== expectedSeq) {
                this.markCorrupt(`sequence gap: expected ${expectedSeq}, found ${String(data.sequence_id)}`);
                return;
            }
            if (data.previous_receipt_hash !== expectedPrev) {
                this.markCorrupt(`previous hash mismatch at sequence ${expectedSeq}: expected ${expectedPrev}, found ${String(data.previous_receipt_hash)}`);
                return;
            }
            const claimed = typeof data.receipt_hash === 'string' ? data.receipt_hash : '';
            const recomputed = this.hashOf(data);
            if (!claimed || claimed !== recomputed) {
                this.markCorrupt(`receipt hash mismatch at sequence ${expectedSeq}: claimed ${claimed}, calculated ${recomputed}`);
                return;
            }
            // Security invariant (Python _verify_file): non-ALLOW => (0, NOT_SENT);
            // ALLOW => (1, RESPONSE_RECEIVED) or (null, SENT_CHILD_NO_RESPONSE).
            const observation = data.execution_observation;
            if (data.arbiter_decision !== 'ALLOW') {
                if (data.backend_execution_count !== 0 || observation !== 'NOT_SENT') {
                    this.markCorrupt(`security invariant violation at sequence ${expectedSeq}: decision is ${String(data.arbiter_decision)} but count is ${String(data.backend_execution_count)}`);
                    return;
                }
            }
            else if (observation === 'RESPONSE_RECEIVED' && data.backend_execution_count !== 1) {
                this.markCorrupt(`invalid execution count at sequence ${expectedSeq}: RESPONSE_RECEIVED with count ${String(data.backend_execution_count)}`);
                return;
            }
            else if (observation === 'SENT_CHILD_NO_RESPONSE' && data.backend_execution_count !== null) {
                this.markCorrupt(`invalid execution count at sequence ${expectedSeq}: SENT_CHILD_NO_RESPONSE with non-null count`);
                return;
            }
            expectedPrev = claimed;
            headHash = claimed;
            expectedSeq += 1;
        }
        this.nextSequenceId = expectedSeq;
        this.lastReceiptHash = headHash;
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /** Advisory cross-process lock so concurrent writers cannot break the chain. */
    async withLock(fn) {
        const lockPath = `${this.path}.lock`;
        let fd = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
            try {
                fd = openSync(lockPath, 'wx');
                writeSync(fd, String(process.pid), null, 'utf8');
                break;
            }
            catch {
                // Stale lock guard: steal after the holder has been idle too long.
                try {
                    const st = statSync(lockPath);
                    if (Date.now() - st.mtimeMs > 2000) {
                        rmSync(lockPath, { force: true });
                        continue;
                    }
                }
                catch {
                    // Lock vanished between check and steal; retry acquisition.
                    continue;
                }
                await this.sleep(25);
            }
        }
        if (fd == null) {
            throw new GatewayLedgerError(`could not acquire ledger lock ${lockPath}`);
        }
        try {
            return fn();
        }
        finally {
            closeSync(fd);
            rmSync(lockPath, { force: true });
        }
    }
    /**
     * Re-syncs chain state from disk under lock so parallel processes each derive
     * the correct next sequence + previous hash before appending.
     */
    resyncFromDisk() {
        if (!existsSync(this.path))
            return;
        const stat = statSync(this.path);
        if (stat.size === 0)
            return;
        const content = readFileSync(this.path, 'utf8');
        let last = null;
        let total = 0;
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (!line)
                continue;
            try {
                last = JSON.parse(line);
                total += 1;
            }
            catch {
                // Leave as-is; recovery already failed closed on malformed content.
            }
        }
        if (last) {
            this.nextSequenceId = total;
            this.lastReceiptHash = typeof last.receipt_hash === 'string' ? last.receipt_hash : this.lastReceiptHash;
        }
    }
    /** Constructs a hash-chained receipt and atomically appends it to disk. */
    async record(input) {
        if (this.corrupted) {
            throw new GatewayLedgerError(`cannot record to corrupted ledger: ${this.corruptionDetail}`);
        }
        let arbiter = input.arbiterDecision;
        let count;
        let observation;
        if (arbiter !== 'ALLOW') {
            count = 0;
            observation = 'NOT_SENT';
        }
        else if (input.observation) {
            observation = input.observation;
            count = observation === 'RESPONSE_RECEIVED' ? 1 : null;
        }
        else {
            observation = 'RESPONSE_RECEIVED';
            count = 1;
        }
        return this.withLock(() => {
            this.resyncFromDisk();
            const seq = this.nextSequenceId;
            const prevHash = this.lastReceiptHash;
            const ts = input.timestamp ?? new Date().toISOString();
            const serverName = input.serverName || undefined;
            const serverId = input.serverId || serverName;
            const childBytes = arbiter !== 'ALLOW'
                ? 0
                : input.childStdinBytes != null
                    ? input.childStdinBytes
                    : undefined;
            const hasDecideMs = typeof input.totalLatencyMs === 'number' && Number.isFinite(input.totalLatencyMs);
            // Latency-bearing lines match Python CURRENT_LEDGER_SCHEMA (v4).
            const schema = hasDecideMs ? LEDGER_SCHEMA_V4 : LEDGER_SCHEMA;
            const receiptFields = {
                schema,
                sequence_id: seq,
                timestamp_utc: ts,
                request_id: input.requestId,
                session_id: input.sessionId,
                principal_id: input.principalId,
                tool_name: input.toolName,
                arguments_hash: input.argumentsHash,
                policy_id: input.policyId,
                policy_hash: input.policyHash,
                cbac_decision: input.cbacDecision,
                difc_decision: input.difcDecision,
                aia_decision: input.aiaDecision,
                arbiter_decision: arbiter,
                backend_execution_count: count,
                execution_observation: observation,
                reason_code: input.reasonCode,
                previous_receipt_hash: prevHash,
                ...(serverId ? { server_id: serverId } : {}),
                ...(serverName ? { server_name: serverName } : {}),
                ...(input.clientName ? { client_name: input.clientName } : {}),
                ...(input.commandDigest ? { command_digest: input.commandDigest } : {}),
                ...(childBytes !== undefined ? { child_stdin_bytes: childBytes } : {}),
                ...(input.traceId ? { trace_id: input.traceId } : {}),
                ...(hasDecideMs ? { total_latency_ms: input.totalLatencyMs } : {}),
            };
            const receiptHash = this.hashOf(receiptFields);
            // Include trace_id on the written line after hash (canonicalDict strips it).
            const lineObj = {
                ...receiptFields,
                receipt_hash: receiptHash,
                ...(input.traceId ? { trace_id: input.traceId } : {}),
            };
            const line = canonicalJson(lineObj);
            const fd = openSync(this.path, 'a');
            try {
                writeSync(fd, `${line}\n`, null, 'utf8');
                fsyncSync(fd);
            }
            finally {
                closeSync(fd);
            }
            this.lastReceiptHash = receiptHash;
            this.nextSequenceId = seq + 1;
            return { ...receiptFields, receipt_hash: receiptHash };
        });
    }
    /** Verifies the whole chain (mirrors ExecutionReceiptLedger.verify). */
    verify() {
        if (!existsSync(this.path))
            return { valid: true, total: 0 };
        const stat = statSync(this.path);
        if (stat.size === 0)
            return { valid: true, total: 0 };
        const content = readFileSync(this.path, 'utf8');
        let expectedSeq = 0;
        let expectedPrev = GENESIS_PREVIOUS_HASH;
        let total = 0;
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (!line)
                continue;
            let data;
            try {
                data = JSON.parse(line);
            }
            catch {
                return { valid: false, total, error: `line ${expectedSeq}: malformed JSON` };
            }
            if (data.sequence_id !== expectedSeq) {
                return { valid: false, total, error: `sequence gap at ${expectedSeq}` };
            }
            if (data.previous_receipt_hash !== expectedPrev) {
                return { valid: false, total, error: `previous hash mismatch at ${expectedSeq}` };
            }
            if (this.hashOf(data) !== data.receipt_hash) {
                return { valid: false, total, error: `receipt hash mismatch at ${expectedSeq}` };
            }
            expectedPrev = data.receipt_hash;
            expectedSeq += 1;
            total += 1;
        }
        return { valid: true, total };
    }
}
/** Lazy process-wide ledger instance. */
let ledgerSingleton = null;
export function isGatewayLedgerEnabled() {
    return process.env.MASTYF_AI_RECEIPT_LEDGER_ENABLED !== 'false';
}
export function getGatewayLedger() {
    if (!ledgerSingleton) {
        ledgerSingleton = new ExecutionReceiptLedger();
    }
    return ledgerSingleton;
}
export function resetGatewayLedgerForTests() {
    ledgerSingleton = null;
}
const HIGH_CONFIDENCE_HEURISTIC_RULES = new Set([
    'deny-dangerous-tools',
    'semantic-url-guard',
    'semantic-sql-guard',
    'block-encoding-evasion',
    'request-prompt-injection',
]);
function ruleToAiaDecision(rule, blocked) {
    if (!blocked)
        return 'ALLOW';
    return HIGH_CONFIDENCE_HEURISTIC_RULES.has(rule) ? 'DENY' : 'NOT_EVALUATED';
}
function extractArguments(msg) {
    const params = msg?.params;
    if (params && params.arguments && typeof params.arguments === 'object') {
        return params.arguments;
    }
    return undefined;
}
function extractRequestId(msg, fallback) {
    const id = msg?.id;
    if (typeof id === 'string' && id.length > 0)
        return id;
    if (typeof id === 'number')
        return String(id);
    if (fallback && fallback.length > 0)
        return fallback;
    return `shield-${randomUUID()}`;
}
/** Attribute CBAC/DIFC/AIA from gateway reason codes instead of inventing CBAC for every block. */
export function layerVotesFromReason(reasonCode, blocked) {
    if (!blocked) {
        return { cbac: 'ALLOW', difc: 'ALLOW', aia: 'NOT_EVALUATED' };
    }
    const code = (reasonCode || '').toUpperCase();
    // Proxy pre-CBAC gates — do not fake CBAC DENY (UI would look like C/D failed to evaluate).
    if (code.includes('FINGERPRINT') ||
        code.includes('RUG_PULL') ||
        code.includes('RUG-PULL') ||
        code === 'TOOL-FINGERPRINT-MISMATCH') {
        return { cbac: 'ALLOW', difc: 'ALLOW', aia: 'NOT_EVALUATED' };
    }
    if (code.includes('HOOK-BEFORE') ||
        code.includes('HOOK_BEFORE') ||
        code.includes('SECRET-SCAN') ||
        code.includes('REQUEST-TIMEOUT') ||
        code.includes('PROXY-MAX-INFLIGHT') ||
        code.includes('PAYLOAD') ||
        code.includes('ARG-ENTROPY')) {
        return { cbac: 'ALLOW', difc: 'ALLOW', aia: 'NOT_EVALUATED' };
    }
    if (code.startsWith('DIFC_') || code.includes('DIFC_FLOW') || code.includes('TAINT') || code.includes('EXFILTRATION')) {
        return { cbac: 'ALLOW', difc: 'DENY', aia: 'NOT_EVALUATED' };
    }
    if (code.startsWith('WORKFLOW_') || code.includes('WORKFLOW_SEQUENCE')) {
        return { cbac: 'ALLOW', difc: 'ALLOW', aia: 'NOT_EVALUATED' };
    }
    if (code.startsWith('AIA_') ||
        code.includes('AUDITOR_') ||
        code.includes('INJECTION') ||
        code.includes('SEMANTIC') ||
        code.includes('GATEWAY_ARBITER')) {
        return { cbac: 'ALLOW', difc: 'ALLOW', aia: 'DENY' };
    }
    if (code.startsWith('CBAC_') || code.includes('CBAC_AUTHORITY') || code.includes('UNKNOWN_TOOL')) {
        return { cbac: 'DENY', difc: 'ALLOW', aia: 'NOT_EVALUATED' };
    }
    if (code.startsWith('ARBITER_') || code === 'DETERMINISTIC_PASS') {
        return { cbac: 'ALLOW', difc: 'ALLOW', aia: 'NOT_EVALUATED' };
    }
    if (code.includes('DIFC'))
        return { cbac: 'ALLOW', difc: 'DENY', aia: 'NOT_EVALUATED' };
    // Unknown shield rules: reason/arbiter carry the stop — do not invent CBAC DENY.
    return { cbac: 'ALLOW', difc: 'ALLOW', aia: 'NOT_EVALUATED' };
}
/** Builds the receipt input for one mediated proxy call (blocked or allowed). */
export function buildReceiptFromCall(record, msg) {
    const blocked = Boolean(record.blocked);
    const rule = record.blockRule || 'mastyf-ai-shield';
    const policyId = process.env.MASTYF_AI_POLICY_ID || 'mastyf-ai-active-policy';
    const requestId = extractRequestId(msg, record.requestId);
    const serverName = record.serverName || 'mcp-server';
    const serverId = record.serverId || serverName;
    // session_id is for FSM isolation only — never the sole source of server identity
    const sessionId = record.sessionId || `${record.tenantId || 'default'}:${serverId}:sess`;
    const principalId = process.env.MASTYF_AI_PRINCIPAL_ID || 'mcp-client';
    const args = extractArguments(msg);
    const commandDigest = record.commandDigest ||
        (record.commandArgs
            ? canonicalHash(record.commandArgs)
            : args
                ? canonicalHash(args)
                : undefined);
    const fromRecord = record;
    const inferred = layerVotesFromReason(rule, blocked);
    const cbacDecision = fromRecord.cbacDecision || inferred.cbac;
    const difcDecision = fromRecord.difcDecision || inferred.difc;
    const aiaDecision = fromRecord.aiaDecision || inferred.aia;
    let traceId = fromRecord.traceId;
    if (!traceId) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getTraceLogFields } = require('../utils/tracing.js');
            traceId = getTraceLogFields().trace_id;
        }
        catch {
            /* OTel unset */
        }
    }
    return {
        requestId,
        sessionId,
        principalId,
        toolName: record.toolName,
        argumentsHash: hashArguments(extractArguments(msg)),
        policyId,
        policyHash: canonicalHash({ policy_id: policyId }),
        cbacDecision,
        difcDecision,
        aiaDecision,
        arbiterDecision: blocked
            ? record.blockReason?.toLowerCase().includes('escalat')
                ? 'ESCALATE'
                : 'BLOCK'
            : 'ALLOW',
        reasonCode: blocked ? rule : 'SHIELD_ALL_CHECKS_PASSED',
        observation: blocked ? 'NOT_SENT' : 'RESPONSE_RECEIVED',
        timestamp: record.timestamp,
        serverId,
        serverName,
        clientName: record.clientName,
        commandDigest,
        childStdinBytes: blocked ? 0 : record.childStdinBytes ?? undefined,
        traceId,
        totalLatencyMs: typeof record.totalLatencyMs === 'number'
            ? record.totalLatencyMs
            : takeDecideLatencyMs(requestId),
    };
}
/** Mints a receipt for one call. Best-effort; never throws into the audit path. */
export async function mintReceiptForCall(record, msg) {
    if (!isGatewayLedgerEnabled())
        return false;
    try {
        const receipt = await getGatewayLedger().record(buildReceiptFromCall(record, msg));
        return receipt.sequence_id >= 0;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=execution-ledger.js.map