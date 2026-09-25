/** Operator grant payload — grants never last forever. */
export const ALLOW_ONCE_TTL_SECONDS = 3600;
export const ALLOW_ALWAYS_TTL_SECONDS = 90 * 86400;
export const BLOCK_TTL_SECONDS = 30 * 86400;
export const BLOCK_PERMANENT_TTL_SECONDS = 90 * 86400;
export function escalationAllowOnceBody(receiptId) {
    return {
        receipt_id: receiptId,
        action: 'allow_once',
        confirmation: true,
        ttl_seconds: ALLOW_ONCE_TTL_SECONDS,
    };
}
export function escalationAllowAlwaysBody(receiptId) {
    return {
        receipt_id: receiptId,
        action: 'allow_always',
        confirmation: true,
        ttl_seconds: ALLOW_ALWAYS_TTL_SECONDS,
    };
}
export function escalationBlockBody(receiptId) {
    return {
        receipt_id: receiptId,
        action: 'block',
        confirmation: true,
        ttl_seconds: BLOCK_TTL_SECONDS,
    };
}
export function escalationBlockPermanentlyBody(receiptId) {
    return {
        receipt_id: receiptId,
        action: 'block_permanently',
        confirmation: true,
        ttl_seconds: BLOCK_PERMANENT_TTL_SECONDS,
    };
}
//# sourceMappingURL=escalation-grant.js.map