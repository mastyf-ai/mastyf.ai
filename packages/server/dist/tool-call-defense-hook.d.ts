/**
 * Defense Fabric hook for lightweight HTTP proxy (packages/server).
 * Implemented by monorepo bridge in src/proxy/create-http-proxy-bridge.ts.
 */
export interface ToolCallDefenseRequest {
    serverName: string;
    toolName: string;
    arguments?: Record<string, unknown>;
    requestId: string;
    requestTokens: number;
    tenantId?: string;
    timestamp?: string;
}
export type ToolCallDefenseHookResult = {
    allowed: true;
    arguments?: Record<string, unknown>;
    spendReservationId?: string;
} | {
    allowed: false;
    code: number;
    rule: string;
    reason: string;
    httpStatus?: number;
};
export interface ToolCallDefenseHook {
    evaluate(req: ToolCallDefenseRequest): Promise<ToolCallDefenseHookResult>;
}
