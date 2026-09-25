import type { ProxyCallRecord } from '../types.js';
export declare const GENESIS_PREVIOUS_HASH: string;
export declare const LEDGER_SCHEMA_V1 = 1;
export declare const LEDGER_SCHEMA_V2 = 2;
export declare const LEDGER_SCHEMA_V3 = 3;
export declare const LEDGER_SCHEMA_V4 = 4;
export declare const LEDGER_SCHEMA = 2;
export type GatewayDecision = 'ALLOW' | 'DENY';
export type GatewayArbiter = 'ALLOW' | 'BLOCK' | 'ESCALATE';
export type ExecutionObservation = 'RESPONSE_RECEIVED' | 'SENT_CHILD_NO_RESPONSE' | 'NOT_SENT';
/** Full receipt line, identical in shape to the Python ledger's written rows. */
export interface LedgerReceipt {
    schema: number;
    sequence_id: number;
    timestamp_utc: string;
    request_id: string;
    session_id: string;
    principal_id: string;
    tool_name: string;
    arguments_hash: string;
    policy_id: string;
    policy_hash: string;
    cbac_decision: GatewayDecision;
    difc_decision: GatewayDecision;
    aia_decision: GatewayDecision | 'NOT_EVALUATED';
    arbiter_decision: GatewayArbiter;
    backend_execution_count: number | null;
    execution_observation: ExecutionObservation;
    reason_code: string;
    previous_receipt_hash: string;
    receipt_hash: string;
    /** Schema v2 first-class MCP identity */
    server_id?: string;
    server_name?: string;
    client_name?: string;
    command_digest?: string;
    child_stdin_bytes?: number | null;
    /** OTel join key — not part of authority hash (see canonicalDict) */
    trace_id?: string;
    total_latency_ms?: number;
}
export interface ExecutionReceiptInput {
    requestId: string;
    sessionId: string;
    principalId: string;
    toolName: string;
    argumentsHash: string;
    policyId: string;
    policyHash: string;
    cbacDecision: GatewayDecision;
    difcDecision: GatewayDecision;
    aiaDecision: GatewayDecision | 'NOT_EVALUATED';
    arbiterDecision: GatewayArbiter;
    reasonCode: string;
    /** Only honored when arbiterDecision is ALLOW. Defaults to RESPONSE_RECEIVED. */
    observation?: ExecutionObservation;
    timestamp?: string;
    serverId?: string;
    serverName?: string;
    clientName?: string;
    commandDigest?: string;
    childStdinBytes?: number | null;
    /** W3C / OTel join — persisted for Grafana; excluded from receipt hash */
    traceId?: string;
    /** Schema v3 decide latency when known (hash-bound when schema >= 3) */
    totalLatencyMs?: number;
}
/** Deterministic compact JSON with recursively sorted keys (canonical_json). */
export declare function canonicalJson(value: unknown): string;
/** SHA-256 hex digest over canonical UTF-8 JSON bytes. */
export declare function canonicalHash(value: unknown): string;
/** Deterministic hash for tool arguments (canonical_hash of the args object). */
export declare function hashArguments(args?: Record<string, unknown>): string;
export declare class GatewayLedgerError extends Error {
    constructor(message: string);
}
export declare class ExecutionReceiptLedger {
    readonly path: string;
    private nextSequenceId;
    private lastReceiptHash;
    private corrupted;
    private corruptionDetail;
    private readonly writeChain;
    constructor(ledgerPath?: string);
    get isCorrupted(): boolean;
    get corruptionReason(): string | undefined;
    get nextSequence(): number;
    get lastHash(): string;
    /** Deterministic dict used for the receipt hash (mirrors to_canonical_dict). */
    private canonicalDict;
    private hashOf;
    private markCorrupt;
    /**
     * Recovers head sequence ID and receipt hash on startup, validating the whole
     * chain. Fails closed on malformed JSON, sequence gaps, hash mismatches, or
     * security-invariant violations — matching the Python ledger's fail-closed
     * recovery.
     */
    private recover;
    private sleep;
    /** Advisory cross-process lock so concurrent writers cannot break the chain. */
    private withLock;
    /**
     * Re-syncs chain state from disk under lock so parallel processes each derive
     * the correct next sequence + previous hash before appending.
     */
    private resyncFromDisk;
    /** Constructs a hash-chained receipt and atomically appends it to disk. */
    record(input: ExecutionReceiptInput): Promise<LedgerReceipt>;
    /** Verifies the whole chain (mirrors ExecutionReceiptLedger.verify). */
    verify(): {
        valid: boolean;
        total: number;
        error?: string;
    };
}
export declare function isGatewayLedgerEnabled(): boolean;
export declare function getGatewayLedger(): ExecutionReceiptLedger;
export declare function resetGatewayLedgerForTests(): void;
/** Attribute CBAC/DIFC/AIA from gateway reason codes instead of inventing CBAC for every block. */
export declare function layerVotesFromReason(reasonCode: string, blocked: boolean): {
    cbac: GatewayDecision;
    difc: GatewayDecision;
    aia: GatewayDecision | 'NOT_EVALUATED';
};
/** Builds the receipt input for one mediated proxy call (blocked or allowed). */
export declare function buildReceiptFromCall(record: ProxyCallRecord, msg?: unknown): ExecutionReceiptInput;
/** Mints a receipt for one call. Best-effort; never throws into the audit path. */
export declare function mintReceiptForCall(record: ProxyCallRecord, msg?: unknown): Promise<boolean>;
//# sourceMappingURL=execution-ledger.d.ts.map