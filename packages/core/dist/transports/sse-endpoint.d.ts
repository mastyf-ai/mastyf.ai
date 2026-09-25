/** Parse MCP SSE `endpoint` event into message URL + session id. */
export declare function parseEndpointFromSse(data: string, baseUrl: URL): {
    sessionId: string;
    messageUrl: URL;
} | null;
export declare function sseProbePaths(baseUrl: URL): string[];
//# sourceMappingURL=sse-endpoint.d.ts.map