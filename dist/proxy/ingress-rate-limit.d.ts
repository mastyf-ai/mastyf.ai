/** Global ingress flood limit (independent of per-client/tool limits). Off when env unset. */
export declare function checkIngressRateLimit(tenantId?: string): Promise<{
    allowed: boolean;
    reason?: string;
}>;
//# sourceMappingURL=ingress-rate-limit.d.ts.map