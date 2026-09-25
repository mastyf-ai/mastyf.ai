/**
 * Shared rug-pull checks for HTTP/SSE/streamable transports.
 */
import { type ToolFingerprintState } from './tool-fingerprint.js';
export declare function isRugPullBlockedForCall(state: ToolFingerprintState, serverName: string, tenantId: string): Promise<boolean>;
export declare function fingerprintJsonRpcToolsList(state: ToolFingerprintState, payload: unknown, serverName: string, tenantId: string, logPrefix?: string): void;
//# sourceMappingURL=rug-pull-transport.d.ts.map