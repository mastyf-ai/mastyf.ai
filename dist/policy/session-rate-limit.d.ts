interface SessionRateLimitOptions {
    maxCallsPerMinute: number;
    sessionId: string;
    toolName?: string;
}
export declare function checkSessionRateLimit(opts: SessionRateLimitOptions): {
    allowed: boolean;
    current: number;
    remaining: number;
};
export declare function createSessionRateLimitHook(maxCallsPerMinute?: number): {
    name: string;
    priority: number;
    beforeToolCall(context: any): Promise<{
        allowed: boolean;
        reason?: string;
    }>;
};
export {};
//# sourceMappingURL=session-rate-limit.d.ts.map