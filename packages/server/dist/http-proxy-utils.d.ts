import * as http from 'http';
import * as https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';
export declare function getMaxBodyBytes(): number;
export declare function getUpstreamTimeoutMs(): number;
export declare function resolveUpstreamPort(url: URL): number;
export declare function isPlaintextUpstreamAllowed(): boolean;
export type UpstreamTlsCheckResult = {
    ok: true;
} | {
    ok: false;
    message: string;
};
/** Reject http:// upstream unless dev-only plaintext flag is set. */
export declare function assertUpstreamTlsAllowed(targetUrl: string): UpstreamTlsCheckResult;
export type ReadBodyResult = {
    ok: true;
    body: string;
} | {
    ok: false;
    tooLarge: true;
    bytes: number;
    limit: number;
};
export declare function readRequestBodyWithLimit(req: IncomingMessage, maxBytes?: number): Promise<ReadBodyResult>;
export declare function validatePemMaterial(buf: Buffer, label: 'CERTIFICATE' | 'PRIVATE KEY' | 'RSA PRIVATE KEY'): void;
export declare function loadInboundTlsFromEnv(): {
    cert: Buffer;
    key: Buffer;
} | null;
export interface RelayToUpstreamOptions {
    upstream: URL;
    method: string;
    headers: http.OutgoingHttpHeaders;
    clientRes: ServerResponse;
    timeoutMs: number;
    agent?: https.Agent;
    /** When set, write this body to upstream. Otherwise pipe `clientReq`. */
    body?: string;
    clientReq?: IncomingMessage;
    /** When set, buffer upstream response up to this many bytes. */
    maxResponseBytes?: number;
    /** JSON-RPC request id for structured upstream error responses (M-013). */
    jsonRpcId?: string | number | null;
    onBufferedResponse?: (responseBody: string, upstreamRes: IncomingMessage) => void | Promise<void>;
}
export declare function relayToUpstream(options: RelayToUpstreamOptions): void;
