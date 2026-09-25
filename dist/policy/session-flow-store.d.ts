export interface FlowEvent {
    toolName: string;
    sensitiveRead: boolean;
    dataAccess: boolean;
    at: number;
    /** Redacted tool arguments for chain classification and intent graph replay. */
    argumentsSnapshot?: Record<string, unknown>;
    /** Normalized argument fingerprint for loop / perturbation detection. */
    argFingerprint?: string;
    /** Request tokens for token-rate loop detection. */
    tokens?: number;
}
export declare function getFlowHistory(sessionKey: string): Promise<FlowEvent[]>;
export declare function getFlowHistorySync(sessionKey: string): FlowEvent[];
export declare function appendFlowEvent(sessionKey: string, event: FlowEvent): Promise<void>;
export declare function appendFlowEventSync(sessionKey: string, event: FlowEvent): void;
/** Mark that a prior tool response contained sensitive data (response-based chain). */
export declare function recordSensitiveResponseAccess(sessionKey: string, toolName: string): void;
export declare function resetSessionFlowStore(): void;
/** Alias for harness / corpus parity. */
export declare const resetSessionFlowHistory: typeof resetSessionFlowStore;
//# sourceMappingURL=session-flow-store.d.ts.map