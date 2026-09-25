export declare function stepUpSessionKey(agentId: string, sessionId: string): string;
export declare function isStepUpCleared(key: string): boolean;
export declare function markStepUpPending(key: string, requestId: string): void;
export declare function hasPendingStepUp(key: string): boolean;
export declare function clearStepUpForRequest(requestId: string, ttlMs?: number): boolean;
export declare function clearStepUpStateForTests(): void;
//# sourceMappingURL=step-up-session.d.ts.map