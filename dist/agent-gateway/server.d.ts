/**
 * gRPC server for `envoy.service.ext_proc.v3.ExternalProcessor`.
 *
 * Google's `CONTENT_AUTHZ` profile speaks `ext_proc` in `FULL_DUPLEX_STREAMED`
 * mode and invokes the extension for request *and* response payloads, so the
 * server has to handle every event, not just the request.
 *
 * ## Why this is a full-message buffer, not a per-chunk ack
 *
 * `processing_mode.proto` describes `FULL_DUPLEX_STREAMED` as giving the server
 * three legitimate options. This service uses option 2: "The server may also
 * choose to buffer the entire message, including the headers ... the entire
 * body, and the trailers ... before sending back any response. The server
 * response has to maintain the headers-body-trailers ordering."
 *
 * Option 1 (ack each chunk as it arrives, decide later) is unusable for an
 * authorizer: the body is already forwarded upstream before the verdict
 * exists, so a deny can only reset a stream it has already polluted. Option 3
 * (respond immediately per chunk) has the same problem. Buffering first is what
 * makes "deny means the request never leaves the gateway" true.
 *
 * ## The response is a mutation, not a receipt
 *
 * In this mode a body request must be answered with a
 * `BodyMutation.streamed_response` (`StreamedBodyResponse`). The sibling fields
 * `body` and `clear_body` are documented as valid only in the other body send
 * modes, and a body request answered *without* forwarded content is answered
 * with an **empty body** -- Google states it directly: "If the extension doesn't
 * send the body contents back, the next extension in the chain receives an empty
 * body." So an empty ack is not a pass-through, it is a truncation. Every body
 * chunk this service receives is echoed back, request and response alike.
 *
 * ## Fail-open surfaces, all of them closed
 *
 * Per the service contract in `external_processor.proto`, a *cleanly* closed
 * gRPC stream means "the data plane proceeds without consulting the server" --
 * that is a silent allow. Two consequences shape this file:
 *
 *  1. A deny always writes an `immediate_response` first; the subsequent clean
 *     close is then a no-op rather than the allow itself.
 *  2. A stream that ends with a request still in flight denies rather than
 *     closing cleanly, and an unwritable stream is destroyed with an error
 *     (a non-OK status surfaces as 500) instead of being closed cleanly.
 *
 * With `failOpen: false` on the extension, Envoy's `failure_mode_allow` stays
 * false, so connect failure, premature error close, timeout, and spurious
 * responses all fail closed with 500/504. See `README.md` for the tested matrix.
 *
 * Chunks are capped at 64 KiB: `processing_mode.proto` recommends no more than
 * 64K per response chunk, which also keeps every message comfortably inside
 * Google's 128 kB `ProcessingResponse` limit.
 */
import * as grpc from '@grpc/grpc-js';
import type { ToolCallDefenseDeps } from '../proxy/tool-call-defense-orchestrator.js';
import type { EnvoyProcessingRequest } from './protos.js';
export interface ExternalProcessorOptions {
    deps: ToolCallDefenseDeps;
    defaultServerName: string;
    defaultTenantId: string;
    /**
     * Ceiling on one authorization decision.
     *
     * `message_timeout` does not apply in `FULL_DUPLEX_STREAMED`, so the data
     * plane imposes no ceiling of its own here -- this is the only guard against a
     * hung policy engine.
     */
    decisionTimeoutMs?: number;
    /**
     * Invoked once per stream, as soon as the request has a verdict (forwarded or
     * denied) or the stream is finished with.
     *
     * Shutdown uses this to tell "answered, safe to close cleanly" from "still
     * deciding, must be destroyed" -- see `destroyUndecidedCalls`. It is a hook
     * rather than a return value because the decision happens deep inside a
     * per-stream closure.
     */
    onSettled?: (call: EnvoyProcessingCall) => void;
}
/** One `Process` stream from the data plane. */
type EnvoyProcessingCall = grpc.ServerDuplexStream<EnvoyProcessingRequest, unknown>;
/**
 * Splits a body into response chunks.
 *
 * A zero-length body still yields one (empty) chunk: dropping it would leave
 * Envoy with no body response at all, and the `end_of_stream` flag has to
 * travel on some message.
 *
 * Exported for the chunk-boundary tests; not part of the service's API.
 */
export declare function splitIntoChunks(body: Buffer, limit?: number): Buffer[];
export declare function createExternalProcessorHandler(opts: ExternalProcessorOptions): {
    Process(call: EnvoyProcessingCall): void;
};
export interface AgentGatewayServer extends grpc.Server {
    /**
     * Destroys every call that is still awaiting a verdict.
     *
     * The `ext_proc` contract says a *cleanly* closed stream means "the data plane
     * proceeds without consulting the server". So a shutdown that ends a half-read
     * request cleanly does not fail closed -- it fails *open*, and
     * `failure_mode_allow: false` does not cover it. Verified against Envoy: a
     * clean close mid-request is admitted with a 200 even with that flag false.
     *
     * Destroying sends a gRPC error instead, which is the abrupt case the data
     * plane does treat as a failure. That is the only way to make a shutdown safe
     * for a request whose verdict is still outstanding.
     *
     * Returns the number of calls destroyed, so shutdown can log it.
     */
    destroyUndecidedCalls(reason: string): number;
}
export declare function createExternalProcessorServer(opts: ExternalProcessorOptions): AgentGatewayServer;
export {};
//# sourceMappingURL=server.d.ts.map