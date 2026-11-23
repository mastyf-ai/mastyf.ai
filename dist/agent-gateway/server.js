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
import { Logger } from '../utils/logger.js';
import { buildDenyResponse, decideRequest, headersToRecord, MAX_BODY_BYTES } from './decision-core.js';
import { ExternalProcessorService } from './protos.js';
const DEFAULT_DECISION_TIMEOUT_MS = 5_000;
/** Per-response-chunk cap: 64 KiB, the value `processing_mode.proto` recommends. */
const RESPONSE_CHUNK_BYTES = 64 * 1024;
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
function toBuffer(body) {
    if (body === undefined || body === null)
        return Buffer.alloc(0);
    if (typeof body === 'string')
        return Buffer.from(body, 'utf8');
    return Buffer.from(body);
}
/**
 * Splits a body into response chunks.
 *
 * A zero-length body still yields one (empty) chunk: dropping it would leave
 * Envoy with no body response at all, and the `end_of_stream` flag has to
 * travel on some message.
 *
 * Exported for the chunk-boundary tests; not part of the service's API.
 */
export function splitIntoChunks(body, limit = RESPONSE_CHUNK_BYTES) {
    if (body.length === 0)
        return [Buffer.alloc(0)];
    const chunks = [];
    for (let offset = 0; offset < body.length; offset += limit) {
        chunks.push(body.subarray(offset, Math.min(offset + limit, body.length)));
    }
    return chunks;
}
export function createExternalProcessorHandler(opts) {
    const timeoutMs = opts.decisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
    return {
        Process(call) {
            /* ---------------------------- per-stream state --------------------------- */
            const requestHeaders = {};
            const requestBodyChunks = [];
            let requestBodyBytes = 0;
            /** A request-phase event has been seen, so an undecided close is a real gap. */
            let requestStarted = false;
            /** Terminal body chunk (or trailers) observed. */
            let requestBodyComplete = false;
            let sawRequestTrailers = false;
            /** The allow/deny verdict has been produced and acted on. */
            let requestForwarded = false;
            /** Set once a deny has been sent; the stream is then finished for good. */
            let terminated = false;
            /**
             * Set when the data plane announced flow-control windows. It must be
             * answered with a window update on our next message, or the data plane
             * cannot tell that flow control is supported.
             */
            let pendingFlowControlAck;
            /**
             * Serialises message handling so responses are emitted in exactly the
             * order Envoy sent its messages, even when the policy engine makes a
             * branch asynchronous.
             */
            let queue = Promise.resolve();
            /**
             * Marks the request as settled -- it now has a verdict, so closing the
             * stream can no longer admit uninspected traffic. Idempotent, because a
             * deny and a forward can both be reached from the same queue turn.
             */
            let settled = false;
            const markSettled = () => {
                if (settled)
                    return;
                settled = true;
                try {
                    opts.onSettled?.(call);
                }
                catch {
                    /* a hook failure must not change the verdict */
                }
            };
            const write = (response) => {
                if (terminated)
                    return;
                try {
                    call.write(response);
                }
                catch (error) {
                    terminated = true;
                    Logger.error(`[agent-gateway] Failed to write response: ${messageOf(error)}`);
                    // Destroying with an error (rather than closing cleanly) is what keeps
                    // a write failure fail-closed: a clean close means "proceed".
                    call.destroy(error instanceof Error ? error : new Error(messageOf(error)));
                }
            };
            /**
             * Attaches a flow-control acknowledgement to the first outgoing message
             * when the data plane offered initial windows.
             */
            const withFlowControl = (response) => {
                if (!pendingFlowControlAck)
                    return response;
                const ack = pendingFlowControlAck;
                pendingFlowControlAck = undefined;
                return { ...response, serverWindowUpdate: ack };
            };
            /**
             * A deny is terminal: `immediate_response` tells the data plane to stop and
             * answer the client itself. The clean close that follows only ends the
             * gRPC stream -- it is not what denies the request.
             */
            const deny = (response) => {
                if (terminated)
                    return;
                terminated = true;
                // The verdict exists the moment it is decided, before it is written, so
                // mark it settled here rather than after the write.
                markSettled();
                try {
                    call.write(withFlowControl(response));
                }
                catch (error) {
                    Logger.error(`[agent-gateway] Failed to write deny: ${messageOf(error)}`);
                }
                call.end();
            };
            /**
             * Builds the body responses that forward `body` onward, split into
             * `RESPONSE_CHUNK_BYTES` pieces with `end_of_stream` on the last one only.
             *
             * `endOfStream` is the *incoming* terminal flag: it says the data plane
             * told us the body is complete, which is the condition for marking the
             * forwarded body complete in turn.
             */
            const bodyResponses = (kind, body, endOfStream) => splitIntoChunks(body, RESPONSE_CHUNK_BYTES).map((chunk, index, all) => {
                const isLast = index === all.length - 1;
                return {
                    [kind]: {
                        response: {
                            bodyMutation: {
                                streamedResponse: {
                                    body: chunk,
                                    endOfStream: isLast && endOfStream,
                                },
                            },
                        },
                    },
                };
            });
            /**
             * Forwards the buffered request now that it is allowed: headers, then body
             * chunks, then trailers. Ordering is mandatory.
             *
             * A trailers response is itself an end-of-stream signal, so the body
             * response omits `end_of_stream` when trailers are on the way.
             */
            const forwardRequest = () => {
                if (requestForwarded)
                    return;
                requestForwarded = true;
                markSettled();
                const body = Buffer.concat(requestBodyChunks);
                const outgoing = [{ requestHeaders: {} }];
                outgoing.push(...bodyResponses('requestBody', body, !sawRequestTrailers));
                if (sawRequestTrailers)
                    outgoing.push({ requestTrailers: {} });
                for (const response of outgoing)
                    write(withFlowControl(response));
            };
            const decideWithTimeout = async () => {
                let timer;
                const expiry = new Promise((resolve) => {
                    timer = setTimeout(() => resolve('timeout'), timeoutMs);
                });
                try {
                    return await Promise.race([
                        decideRequest({
                            headers: requestHeaders,
                            body: Buffer.concat(requestBodyChunks),
                            deps: opts.deps,
                            defaultServerName: opts.defaultServerName,
                            defaultTenantId: opts.defaultTenantId,
                        }),
                        expiry,
                    ]);
                }
                finally {
                    if (timer)
                        clearTimeout(timer);
                }
            };
            /* ------------------------------- handlers ------------------------------ */
            /**
             * Request headers. Stays silent so the body can still be withheld: an
             * `end_of_stream` here means there is no body at all, hence no tool call to
             * authorize, so the request simply continues.
             */
            const handleRequestHeaders = (payload) => {
                requestStarted = true;
                Object.assign(requestHeaders, headersToRecord(payload));
                if (payload.endOfStream) {
                    requestForwarded = true;
                    write(withFlowControl({ requestHeaders: {} }));
                }
            };
            /**
             * One request-body chunk. Buffered, never answered individually -- the
             * terminal chunk is what triggers the decision.
             */
            const handleRequestBody = async (payload) => {
                requestStarted = true;
                if (requestForwarded)
                    return;
                const chunk = toBuffer(payload.body);
                requestBodyBytes += chunk.length;
                // Incremental cap: refuse while the stream is still arriving rather than
                // after a full oversized body is in memory. parseToolCall checks the same
                // limit, but only once the whole body has already been buffered.
                if (requestBodyBytes > MAX_BODY_BYTES) {
                    deny(buildDenyResponse({
                        code: 403,
                        details: `payload-too-large: streamed request body exceeded ${MAX_BODY_BYTES} bytes`,
                    }));
                    return;
                }
                requestBodyChunks.push(chunk);
                if (!payload.endOfStream)
                    return;
                requestBodyComplete = true;
                await decideAndForward();
            };
            /**
             * Request trailers. Their arrival is the end-of-body signal, and they must
             * be forwarded after the body.
             *
             * The body can also have completed via `end_of_stream` first, in which case
             * the trailers were not part of the ordered sequence that was already sent.
             * They still need a response of their own: every message gets an answer, and
             * an unanswered one stalls the data plane.
             */
            const handleRequestTrailers = async () => {
                requestStarted = true;
                sawRequestTrailers = true;
                if (requestForwarded) {
                    write(withFlowControl({ requestTrailers: {} }));
                    return;
                }
                if (!requestBodyComplete)
                    requestBodyComplete = true;
                await decideAndForward();
            };
            const decideAndForward = async () => {
                if (requestForwarded)
                    return;
                let outcome;
                try {
                    outcome = await decideWithTimeout();
                }
                catch (error) {
                    Logger.error(`[agent-gateway] Decision failed; failing closed: ${messageOf(error)}`);
                    deny(buildDenyResponse({
                        code: 403,
                        details: `fail-closed-invariant: DECISION_ERROR (${messageOf(error)})`,
                    }));
                    return;
                }
                if (outcome === 'timeout') {
                    Logger.error('[agent-gateway] Decision timed out; failing closed');
                    deny(buildDenyResponse({
                        code: 403,
                        details: 'fail-closed-invariant: DECISION_TIMEOUT',
                    }));
                    return;
                }
                if (outcome.immediateResponse) {
                    deny(outcome);
                    return;
                }
                forwardRequest();
            };
            /**
             * Response headers: pass through untouched.
             *
             * Google invokes a `CONTENT_AUTHZ` extension for response payloads as well
             * as requests, so these events are the normal case, not an edge case. This
             * service makes no response decision, so it returns no header mutation --
             * but it must return a *response*, or the data plane stalls.
             */
            const handleResponseHeaders = () => {
                write(withFlowControl({ responseHeaders: {} }));
            };
            /**
             * Response body: echoed immediately, unbuffered and unread.
             *
             * `processing_mode.proto` option 3 explicitly allows responding to a body
             * request without buffering. Echoing each chunk on arrival means the
             * service never holds a response body in memory, and the bytes are passed
             * through without being read -- so it cannot become a response-exfiltration
             * path.
             */
            const handleResponseBody = (payload) => {
                for (const response of bodyResponses('responseBody', toBuffer(payload.body), Boolean(payload.endOfStream))) {
                    write(withFlowControl(response));
                }
            };
            const handleResponseTrailers = () => {
                write(withFlowControl({ responseTrailers: {} }));
            };
            const handleMessage = async (request) => {
                if (terminated)
                    return;
                // `flow_control_init` is a sibling of the oneof. Answering it separately
                // would be a spurious response, which the data plane treats as a stream
                // error, so it is folded into the next real response instead.
                if (request.flowControlInit && !pendingFlowControlAck) {
                    const init = request.flowControlInit;
                    pendingFlowControlAck = {
                        windowIncrementSidestreamToUpstream: init.initialWindowSidestreamToUpstream ?? 0,
                        windowIncrementSidestreamToDownstream: init.initialWindowSidestreamToDownstream ?? 0,
                    };
                }
                // A ProcessingRequest carries exactly one field of the oneof, so these
                // checks are mutually exclusive and a plain if/else is enough. The final
                // `return` is the important one: an unset oneof (a flow-control-only
                // message) gets no reply at all.
                if (request.requestHeaders)
                    return handleRequestHeaders(request.requestHeaders);
                if (request.requestBody)
                    return handleRequestBody(request.requestBody);
                if (request.requestTrailers)
                    return handleRequestTrailers();
                if (request.responseHeaders)
                    return handleResponseHeaders();
                if (request.responseBody)
                    return handleResponseBody(request.responseBody);
                if (request.responseTrailers)
                    return handleResponseTrailers();
            };
            call.on('data', (request) => {
                queue = queue.then(() => handleMessage(request)).catch((error) => {
                    // Should be unreachable -- each handler catches its own failures -- but
                    // a deny is the only safe answer for an unhandled defect on the
                    // authorization path.
                    Logger.error(`[agent-gateway] Unhandled stream defect; failing closed: ${messageOf(error)}`);
                    deny(buildDenyResponse({
                        code: 403,
                        details: `fail-closed-invariant: STREAM_ERROR (${messageOf(error)})`,
                    }));
                });
            });
            call.on('error', (error) => {
                // The data plane aborted the stream. Logged, not treated as an allow.
                terminated = true;
                Logger.warn(`[agent-gateway] Stream error: ${error.message}`);
            });
            call.on('end', () => {
                // The data plane half-closed. Let any in-flight decision finish first.
                queue = queue
                    .then(() => undefined)
                    .catch(() => undefined)
                    .then(() => {
                    if (terminated)
                        return;
                    // A clean close is read as "proceed without consulting the server",
                    // so an undecided request must never reach it.
                    if (requestStarted && !requestForwarded) {
                        Logger.error('[agent-gateway] Stream ended with an undecided request; failing closed');
                        deny(buildDenyResponse({
                            code: 403,
                            details: 'fail-closed-invariant: STREAM_CLOSED_MID_REQUEST',
                        }));
                        return;
                    }
                    try {
                        call.end();
                    }
                    catch (error) {
                        Logger.warn(`[agent-gateway] Stream already closed on end: ${messageOf(error)}`);
                    }
                });
            });
        },
    };
}
export function createExternalProcessorServer(opts) {
    /** Calls that have seen request-phase traffic and have no verdict yet. */
    const undecided = new Set();
    const server = new grpc.Server({
        'grpc.max_receive_message_length': 16 * 1024 * 1024,
        // Headroom over Google's 128 kB ProcessingResponse cap. Real responses are
        // 64 KiB chunks plus small headers/trailers messages.
        'grpc.max_send_message_length': 1024 * 1024,
    });
    // One hook for every stream, keyed by the call the handler passes back. The
    // alternative -- a closure rebuilt per call -- would let a stream's verdict
    // release whichever call happened to be registered last.
    const release = (call) => {
        undecided.delete(call);
    };
    const handler = createExternalProcessorHandler({ ...opts, onSettled: release });
    server.addService(ExternalProcessorService.service, {
        Process(call) {
            undecided.add(call);
            // A call that errors or ends can no longer admit anything either, so
            // release it there too rather than leak a dead call in the set.
            call.on('error', () => release(call));
            call.on('end', () => release(call));
            handler.Process(call);
        },
    });
    server.destroyUndecidedCalls = function destroyUndecidedCalls(reason) {
        let destroyed = 0;
        for (const call of [...undecided]) {
            undecided.delete(call);
            try {
                call.destroy(new Error(reason));
                destroyed += 1;
            }
            catch {
                /* already gone */
            }
        }
        return destroyed;
    };
    return server;
}
//# sourceMappingURL=server.js.map