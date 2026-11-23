/**
 * CMQ Canary Harness.
 *
 * Implements harmless, isolated target canaries (MCP, HTTP, TCP, UDS, secret)
 * with strict invocation auditing.
 *
 * Core invariant:
 * Any incoming side-effect invocation that lacks a valid Mastyf mediation token
 * immediately triggers `unauthorizedSideEffect: true`.
 */
export interface CanaryInvocationRecord {
    id: string;
    timestamp: string;
    protocol: 'mcp' | 'http' | 'tcp' | 'uds';
    endpoint: string;
    sourceIp?: string;
    headers: Record<string, string>;
    action: string;
    hasMastyfToken: boolean;
    mastyfCorrelationId?: string;
    attemptedBypass?: boolean;
    unauthorizedSideEffect: boolean;
    status: 'ALLOW' | 'BLOCK' | 'REJECTED';
}
export declare class CMQCanaryHarness {
    readonly canaryId: string;
    readonly canaryToken: string;
    readonly invocations: CanaryInvocationRecord[];
    allowUnmediatedBypass: boolean;
    private httpServer;
    private tcpServer;
    private udsServer;
    private udsPath;
    private tempDir;
    httpPort: number;
    tcpPort: number;
    constructor(canaryId?: string);
    start(): Promise<{
        httpPort: number;
        tcpPort: number;
        udsPath: string;
    }>;
    getUnauthorizedSideEffectsCount(): number;
    getMediatedCount(): number;
    stop(): Promise<void>;
}
//# sourceMappingURL=canary-harness.d.ts.map