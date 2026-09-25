import type { TLSSocket } from 'tls';
export declare function resetUpstreamCertPinsForTests(): void;
export declare function loadUpstreamCertPins(): Set<string>;
export declare function spkiSha256FromDer(certDer: Buffer): string;
/** Node checkServerIdentity hook — validates leaf cert SPKI against configured pins. */
export declare function createCertPinCheck(): ((host: string, cert: {
    raw: Buffer;
}) => Error | undefined) | undefined;
/** Attach cert pin validation to an https.Agent options object. */
export declare function applyCertPinToAgentOptions(opts: import('https').AgentOptions): import('https').AgentOptions;
export declare function assertPinnedTlsSocket(socket: TLSSocket): void;
//# sourceMappingURL=upstream-cert-pin.d.ts.map