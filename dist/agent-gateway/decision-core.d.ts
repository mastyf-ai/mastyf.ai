/**
 * Decision core for the Google Agent Gateway `CONTENT_AUTHZ` extension.
 *
 * This module is deliberately free of gRPC and process concerns: it takes a fully
 * received `(headers, body)` pair and returns an `EnvoyProcessingResponse`. That
 * keeps the security decision unit-testable without a socket, and keeps the
 * stream plumbing in `server.ts` from ever making a policy call.
 *
 * Two rules hold throughout:
 *
 *  1. **Allow and deny are the only two outcomes, and deny always carries an
 *     `immediateResponse`.** The empty object returned for an allow is a
 *     sentinel meaning "no denial", not a message to put on the wire: in
 *     `FULL_DUPLEX_STREAMED` the data plane requires a body request to be
 *     answered with a `streamedResponse` carrying the bytes onward, so
 *     `server.ts` turns this sentinel into the ordered headers/body/trailers
 *     sequence. Treating the empty object as an on-the-wire response would
 *     forward an empty body. The service never rewrites or inspects response
 *     bodies, so it cannot become a data-exfiltration path.
 *
 *  2. **Anything unrecognised is denied.** An unknown payload shape is not
 *     "not a tool call, therefore fine" -- it is a payload this service cannot
 *     reason about. It denies with a distinct `unrecognised-payload` rule so the
 *     case is visible in logs rather than silently passing.
 */
import type { ToolCallDefenseInput, ToolCallDefenseDeps } from '../proxy/tool-call-defense-orchestrator.js';
import type { EnvoyHttpHeaders, EnvoyProcessingResponse } from './protos.js';
/** Result of shaping the inbound payload into a policy input. */
export type ToolCallParse = {
    ok: true;
    input: ToolCallDefenseInput;
} | {
    ok: false;
    rule: string;
    reason: string;
};
/**
 * Max request body this service will buffer and parse.
 *
 * `FULL_DUPLEX_STREAMED` permits buffering the whole message, which is exactly
 * what the server does so a deny can precede any upstream forwarding. This cap
 * is a separate, deliberate bound on that buffer: an oversized body is denied
 * while it is still arriving rather than after it is fully resident.
 */
export declare const MAX_BODY_BYTES: number;
/**
 * Largest serialized `arguments` object this service will hand to the policy
 * engine.
 *
 * This bound exists because of a measured property of the engine, not a guess.
 * `scanForSecrets` runs 268 rules as 268 independent full-string passes, so the
 * decision cost is linear in argument size with a large constant. Measured on the
 * development machine: ~126 ms at 1 kB, ~6.5 s at 50 kB, and still unfinished at
 * 200 kB. The decision timeout cannot rescue that, because the scan is
 * synchronous and blocks the event loop -- a `Promise.race` on a timer does not
 * fire while the CPU is busy.
 *
 * So a large argument object is refused here, before the engine runs, rather than
 * being allowed to stall past the gateway's own extension timeout and surface as
 * an opaque 5xx. A 403 that names its reason is both fail-closed and more useful
 * than a timeout.
 *
 * Deliberately *not* a truncation: scanning only a prefix would leave the tail
 * uninspected, which is a security hole wearing a performance fix's clothing.
 *
 * The cost is real. A legitimate `write_file` or long query can exceed 32 KiB and
 * will be refused. Raising this cap means raising the decision timeout and the
 * extension's `grpc_service.timeout` with it, or fixing the scanner's asymptotics
 * (a worker thread with a hard terminate, or a cheap prefilter that cannot drop a
 * rule). Do not raise it without re-measuring.
 */
export declare const MAX_SCANNED_ARGUMENT_BYTES: number;
/**
 * Maps a policy verdict code onto a valid HTTP status.
 *
 * The orchestrator is transport-agnostic and reports MCP/JSON-RPC error codes,
 * which are *negative* (for example -32001). Those are meaningless as an HTTP
 * status, so a raw pass-through would put an invalid status on the wire. A
 * denial is a client-side refusal, hence 4xx; anything outside that range
 * collapses to 403. The original code is preserved in the response body so the
 * transport-specific reason is not lost.
 */
export declare function toHttpStatus(code: number | undefined): number;
/**
 * The allow sentinel.
 *
 * Deliberately *not* an on-the-wire `ProcessingResponse`: see the module note on
 * allow/deny. `server.ts` reads the absence of `immediateResponse` as an allow
 * and emits the required `streamedResponse` body mutation instead.
 */
export declare function buildAllowResponse(): EnvoyProcessingResponse;
export declare function buildDenyResponse(params: {
    code: number;
    details: string;
    body?: unknown;
}): EnvoyProcessingResponse;
/** Flattens an Envoy `HeaderMap` into a plain lower-cased record. */
export declare function headersToRecord(headers: EnvoyHttpHeaders | undefined): Record<string, string>;
/**
 * Shapes a received HTTP request into a policy input.
 *
 * Supports the MCP JSON-RPC `tools/call` shape. Any other JSON-RPC method, a
 * non-JSON body, an oversized body, or JSON that does not match the expected
 * shape all fail closed with a specific rule.
 */
export declare function parseToolCall(params: {
    headers: Record<string, string>;
    body: Buffer;
    defaultServerName: string;
    defaultTenantId: string;
}): ToolCallParse;
/**
 * Runs the Mastyf defense pipeline for one received request and maps the verdict
 * onto an Envoy response.
 */
export declare function decideRequest(params: {
    headers: Record<string, string>;
    body: Buffer;
    deps: ToolCallDefenseDeps;
    defaultServerName: string;
    defaultTenantId: string;
}): Promise<EnvoyProcessingResponse>;
//# sourceMappingURL=decision-core.d.ts.map