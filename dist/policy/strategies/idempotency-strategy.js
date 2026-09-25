import { hashIdempotentPayload, isDuplicateIdempotentRequest, } from '../idempotency-store.js';
/** Block duplicate idempotency keys within TTL (block mode only). */
export async function evaluateIdempotency(context, mode) {
    if (mode !== 'block' || !context.idempotencyKey)
        return null;
    const tenant = context.tenantId || process.env['MASTYF_AI_TENANT_ID'] || 'default';
    const cacheKey = hashIdempotentPayload(tenant, context.serverName, context.toolName, context.arguments, context.idempotencyKey);
    if (await isDuplicateIdempotentRequest(cacheKey, tenant)) {
        return {
            action: 'block',
            rule: 'idempotency-replay',
            reason: `Duplicate idempotency key '${context.idempotencyKey}' within TTL`,
        };
    }
    return null;
}
//# sourceMappingURL=idempotency-strategy.js.map