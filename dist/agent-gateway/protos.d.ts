import * as grpc from '@grpc/grpc-js';
/**
 * `keepCase: false`   -- fields arrive camelCased, matching the rest of this codebase.
 * `enums: String`     -- readable names ('Forbidden') rather than magic numbers.
 * `longs: String`     -- no 64-bit precision loss on flow-control window sizes.
 * `oneofs: true`      -- the `request`/`response` oneofs are what this service dispatches on.
 * `defaults: true`    -- unset fields read as falsy values rather than undefined.
 */
export declare const LOADER_OPTIONS: {
    keepCase: boolean;
    longs: StringConstructor;
    enums: StringConstructor;
    defaults: boolean;
    oneofs: boolean;
    includeDirs: string[];
};
/** gRPC service definition for `envoy.service.ext_proc.v3.ExternalProcessor`. */
export declare const ExternalProcessorService: grpc.ServiceClientConstructor;
export interface EnvoyHeaderValue {
    key?: string;
    /** Preferred: raw bytes, always present on the wire. */
    rawValue?: Buffer | Uint8Array | string;
    value?: string;
}
export interface EnvoyHttpHeaders {
    headers?: {
        headers?: EnvoyHeaderValue[];
    };
    endOfStream?: boolean;
}
export interface EnvoyHttpBody {
    body?: Buffer | Uint8Array | string;
    endOfStream?: boolean;
}
export interface EnvoyProcessingRequest {
    requestHeaders?: EnvoyHttpHeaders;
    responseHeaders?: EnvoyHttpHeaders;
    requestBody?: EnvoyHttpBody;
    responseBody?: EnvoyHttpBody;
    requestTrailers?: EnvoyHttpTrailers;
    responseTrailers?: EnvoyHttpTrailers;
    /** Present when the oneof field is explicitly set (loader option `oneofs: true`). */
    request?: string;
    /** Encoded only in the first message of the stream. */
    protocolConfig?: unknown;
    observabilityMode?: boolean;
    /**
     * Initial flow-control windows, set on the first message in
     * `FULL_DUPLEX_STREAMED` / `GRPC` modes. Lives *outside* the `request` oneof, so
     * a message carrying only this field must not be answered.
     */
    flowControlInit?: EnvoyFlowControlInit;
    clientWindowUpdate?: unknown;
}
export interface EnvoyHttpTrailers {
    headers?: {
        headers?: EnvoyHeaderValue[];
    };
}
export interface EnvoyFlowControlInit {
    initialWindowDownstreamToSidestream?: string | number;
    initialWindowSidestreamToUpstream?: string | number;
    initialWindowUpstreamToSidestream?: string | number;
    initialWindowSidestreamToDownstream?: string | number;
}
export interface EnvoyServerWindowUpdate {
    windowIncrementSidestreamToUpstream?: string | number;
    windowIncrementSidestreamToDownstream?: string | number;
}
export interface EnvoyImmediateResponse {
    status: {
        code: string | number;
    };
    body?: Buffer;
    details?: string;
    headers?: {
        setOrAdd?: EnvoyHeaderOption[];
        remove?: string[];
    };
}
export interface EnvoyHeaderOption {
    header: {
        key: string;
        value?: string;
        rawValue?: Buffer | Uint8Array | string;
    };
    appendAction?: string;
}
/**
 * The body chunk the data plane forwards upstream/downstream.
 *
 * `BodyMutation.streamed_response` is the *only* legal body mutation in
 * `FULL_DUPLEX_STREAMED`; `body` and `clear_body` are documented as valid only
 * in the other body send modes. A `FULL_DUPLEX_STREAMED` body request that is
 * answered without one of these is answered with an empty body, so the
 * mutation is mandatory rather than an optimisation.
 */
export interface EnvoyStreamedBodyResponse {
    body?: Buffer;
    /** Set on the final forwarded chunk; a trailers response is the alternative. */
    endOfStream?: boolean;
}
export interface EnvoyBodyMutation {
    streamedResponse?: EnvoyStreamedBodyResponse;
}
export interface EnvoyCommonResponse {
    /** `CONTINUE` (the default) applies the mutation and carries on. */
    status?: string;
    bodyMutation?: EnvoyBodyMutation;
}
export interface EnvoyHeadersResponse {
    response?: EnvoyCommonResponse;
}
/** Structurally identical to `EnvoyHeadersResponse`; kept separate for clarity. */
export interface EnvoyBodyResponse {
    response?: EnvoyCommonResponse;
}
export interface EnvoyTrailersResponse {
    headerMutation?: unknown;
}
export interface EnvoyProcessingResponse {
    immediateResponse?: EnvoyImmediateResponse;
    requestHeaders?: EnvoyHeadersResponse;
    responseHeaders?: EnvoyHeadersResponse;
    requestBody?: EnvoyBodyResponse;
    responseBody?: EnvoyBodyResponse;
    requestTrailers?: EnvoyTrailersResponse;
    responseTrailers?: EnvoyTrailersResponse;
    /** Sibling of the oneof, not part of it. */
    serverWindowUpdate?: EnvoyServerWindowUpdate;
}
//# sourceMappingURL=protos.d.ts.map