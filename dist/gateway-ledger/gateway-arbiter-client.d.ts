export interface GatewayDecideInput {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    userIntent?: string;
    retrievedContext?: string;
    sessionId?: string;
    principalId?: string;
    serverId?: string;
    serverName?: string;
    requestId?: string;
    tenantId?: string;
}
export interface GatewayDecideResult {
    available: boolean;
    finalDecision: 'ALLOW' | 'BLOCK' | 'ESCALATE';
    executionPermitted: boolean;
    reasonCode: string;
    cbacDecision?: string;
    difcDecision?: string;
    aiaDecision?: string;
    workflowDecision?: string;
    policyHash?: string;
    bytesSent?: number;
    receiptId?: string;
    executionObservation?: string;
    totalLatencyMs?: number;
    raw?: Record<string, unknown>;
    error?: string;
}
export declare function isGatewayArbiterEnabled(): boolean;
export declare function rememberDecideLatencyMs(requestId: string, ms: number): void;
export declare function takeDecideLatencyMs(requestId?: string): number | undefined;
export declare function decideViaGateway(input: GatewayDecideInput): Promise<GatewayDecideResult>;
//# sourceMappingURL=gateway-arbiter-client.d.ts.map