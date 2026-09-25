/** Operator grant payload — grants never last forever. */
export declare const ALLOW_ONCE_TTL_SECONDS = 3600;
export declare const ALLOW_ALWAYS_TTL_SECONDS: number;
export declare const BLOCK_TTL_SECONDS: number;
export declare const BLOCK_PERMANENT_TTL_SECONDS: number;
export declare function escalationAllowOnceBody(receiptId: string): {
    receipt_id: string;
    action: 'allow_once';
    confirmation: true;
    ttl_seconds: number;
};
export declare function escalationAllowAlwaysBody(receiptId: string): {
    receipt_id: string;
    action: 'allow_always';
    confirmation: true;
    ttl_seconds: number;
};
export declare function escalationBlockBody(receiptId: string): {
    receipt_id: string;
    action: 'block';
    confirmation: true;
    ttl_seconds: number;
};
export declare function escalationBlockPermanentlyBody(receiptId: string): {
    receipt_id: string;
    action: 'block_permanently';
    confirmation: true;
    ttl_seconds: number;
};
//# sourceMappingURL=escalation-grant.d.ts.map