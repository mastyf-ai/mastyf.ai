export interface Receipt {
    action: 'block' | 'pass';
    toolName: string;
    serverName: string;
    rule: string;
    reason: string;
    timestamp: string;
    requestId: string;
    previousReceiptHash: string | null;
}
export interface SignedReceipt extends Receipt {
    signature: string;
    receiptHash: string;
    publicKey: string;
    chainIndex: number;
}
export declare function buildReceipt(input: Omit<Receipt, 'previousReceiptHash'>): SignedReceipt;
export declare function verifyReceipt(signed: SignedReceipt): boolean;
export declare function verifyChain(fromDate?: string): {
    valid: boolean;
    chainLength: number;
    tampered: boolean;
};
export declare function getChainStatus(): {
    chainLength: number;
    lastHash: string | null;
    valid: boolean;
};
export declare function exportReceipts(format: 'jsonl' | 'sigstore'): string;
//# sourceMappingURL=receipt-builder.d.ts.map