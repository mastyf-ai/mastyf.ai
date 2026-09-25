/** Per-client rate limit keyed by agent sub + tool (legacy HTTP proxy parity with stdio). */
export declare function checkHttpClientRateLimit(clientKey: string, toolName: string, tenantId: string): Promise<{
    allowed: boolean;
    reason?: string;
}>;
//# sourceMappingURL=client-rate-limit.d.ts.map