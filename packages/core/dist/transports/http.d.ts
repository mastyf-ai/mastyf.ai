import type { ToolDefinition } from "../types.js";
export interface HttpServerConfig {
    url: string;
    headers?: Record<string, string>;
    /** Per JSON-RPC request timeout (default 10_000). Each request gets the full budget. */
    timeoutMs?: number;
    /** Optional wall-clock cap for the full initialize + tools/list handshake. */
    totalTimeoutMs?: number;
}
export declare function fetchToolsFromHttp(config: HttpServerConfig): Promise<ToolDefinition[]>;
export declare function fetchToolsFromSse(config: HttpServerConfig): Promise<ToolDefinition[]>;
export { parseEndpointFromSse, sseProbePaths } from "./sse-endpoint.js";
export { resetHttpFetchClientsForTests } from "./http-fetch-client.js";
//# sourceMappingURL=http.d.ts.map