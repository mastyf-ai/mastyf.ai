export declare function idempotencyKeyFromRequest(meta?: Record<string, unknown>, headerKey?: string): string | undefined;
export declare function hashIdempotentPayload(tenantId: string, serverName: string, toolName: string, args: unknown, key: string): string;
/**
 * Returns true if this idempotency key was already seen (duplicate).
 */
export declare function isDuplicateIdempotentRequest(cacheKey: string, tenantId: string): Promise<boolean>;
export declare function resetIdempotencyStoreForTests(): void;
//# sourceMappingURL=idempotency-store.d.ts.map