export interface ApprovalRequest {
    id: string;
    approvalId: string;
    serverName: string;
    toolName: string;
    arguments: Record<string, unknown>;
    tenantId: string;
    identity: string;
    status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
    createdAt: string;
    expiresAt: string;
    resolvedAt?: string;
    resolvedBy?: string;
}
export declare function approvalStoreDir(): string;
export declare function persistApprovalRequest(req: ApprovalRequest): void;
export declare function listPendingApprovals(tenantId?: string): ApprovalRequest[];
export declare function findPendingMatch(params: {
    toolName: string;
    serverName: string;
    tenantId?: string;
}): ApprovalRequest | null;
/** Single-use: an `mastyf-ai approve` lets the next matching tools/call through. */
export declare function consumeApprovedMatch(params: {
    toolName: string;
    serverName: string;
    tenantId?: string;
}): ApprovalRequest | null;
export declare function resolveApproval(approvalId: string, action: 'approved' | 'denied', resolvedBy?: string): boolean;
//# sourceMappingURL=approval-store.d.ts.map