/**
 * Multi-Step Attack Chain Detector
 *
 * Tracks sequences of tool calls within a session to detect composite,
 * multi-stage attack campaigns before catastrophic exfiltration occurs.
 *
 * Example:
 *   Step 1: read_file(/etc/passwd)
 *   Step 2: read_file(.aws/credentials)
 *   Step 3: curl / push_files (Exfiltration Attempt)
 */
export interface TrackedCall {
    sessionId: string;
    serverName: string;
    toolName: string;
    arguments: Record<string, unknown>;
    timestamp: number;
    blocked: boolean;
}
export interface AttackChainMatch {
    chainName: string;
    severity: 'high' | 'critical';
    confidence: number;
    description: string;
    matchedSteps: Array<{
        toolName: string;
        matchedPattern: string;
    }>;
}
export declare class AttackChainDetector {
    private sessionHistory;
    private readonly windowMs;
    constructor(options?: {
        windowMs?: number;
    });
    recordCall(call: TrackedCall): AttackChainMatch | null;
    private evaluateChains;
    clearSession(sessionId: string): void;
}
export declare const globalAttackChainDetector: AttackChainDetector;
//# sourceMappingURL=attack-chain-detector.d.ts.map