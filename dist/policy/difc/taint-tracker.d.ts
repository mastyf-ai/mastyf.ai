import type { SecrecyTag, IntegrityTag, SessionTaintState, DeclassificationGrant } from './difc-types.js';
export interface DIFCEvaluationResult {
    allowed: boolean;
    violation?: {
        sourceTool: string;
        sinkTool: string;
        secrecyTag: SecrecyTag;
        matchedSample: string;
        reason: string;
    };
    taintContext: {
        hasIntegrityTaint: boolean;
        activeIntegrityTags: string[];
        secrecyViolations: string[];
    };
}
export declare class SessionTaintTracker {
    private sessions;
    constructor();
    getOrCreateSession(sessionKey: string): SessionTaintState;
    /**
     * Ingest a tool execution response into the session's information flow state.
     */
    ingestToolResponse(params: {
        sessionKey: string;
        toolName: string;
        output: unknown;
        explicitSecrecyTags?: SecrecyTag[];
        explicitIntegrityTags?: IntegrityTag[];
    }): void;
    /**
     * Extract meaningful sensitive substrings from text and index them in session memory.
     */
    private extractAndStoreFragments;
    private addFragment;
    /**
     * Evaluate proposed tool call arguments against the session's DIFC state.
     * Deterministically intercepts cross-tool secret exfiltration.
     */
    evaluateDIFC(params: {
        sessionKey: string;
        toolName: string;
        args?: Record<string, unknown>;
    }): DIFCEvaluationResult;
    private hasValidDeclassificationGrant;
    /**
     * Authorize an explicit declassification grant for the session.
     */
    addDeclassificationGrant(grant: DeclassificationGrant): void;
    /**
     * Reset session state (useful for tests or session boundary close).
     */
    resetSession(sessionKey: string): void;
}
export declare const globalSessionTaintTracker: SessionTaintTracker;
//# sourceMappingURL=taint-tracker.d.ts.map