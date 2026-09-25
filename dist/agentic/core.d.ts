/**
 * Agentic Core Framework — base classes for all autonomous AI features.
 *
 * Every agentic feature (policy generation, threat prediction, prompt injection
 * detection, etc.) extends these base classes to ensure consistent:
 *   - lifecycle (init → execute → audit)
 *   - telemetry / observability
 *   - error handling and retry
 *   - human-in-the-loop approval gates
 */
export interface AgenticDecision {
    /** Unique decision id (UUID v4) */
    decisionId: string;
    /** The tool/feature that made this decision */
    source: string;
    /** Human-readable rationale */
    rationale: string;
    /** Confidence 0-1 */
    confidence: number;
    /** Whether this decision requires human approval before actioning */
    requiresApproval: boolean;
    /** Suggested action (for audit trail) */
    suggestedAction: string;
    /** Timestamp */
    timestamp: string;
    /** Arbitrary metadata */
    metadata?: Record<string, unknown>;
}
export declare class AgenticResult<T = unknown> {
    readonly success: boolean;
    readonly data?: T | undefined;
    readonly error?: string | undefined;
    readonly decisions: AgenticDecision[];
    readonly executionTimeMs: number;
    constructor(success: boolean, data?: T | undefined, error?: string | undefined, decisions?: AgenticDecision[], executionTimeMs?: number);
    static ok<T>(data: T, decisions?: AgenticDecision[], executionTimeMs?: number): AgenticResult<T>;
    static fail<T>(error: string, decisions?: AgenticDecision[]): AgenticResult<T>;
    get isSuccess(): boolean;
}
export interface IAgenticTool {
    readonly toolName: string;
    execute(args: Record<string, unknown>): Promise<AgenticResult>;
}
export type PipelineStage<TContext = Record<string, unknown>> = (ctx: TContext) => Promise<{
    ctx: TContext;
    decisions: AgenticDecision[];
}>;
export declare class AgenticPipeline<TContext = Record<string, unknown>> {
    readonly pipelineName: string;
    private stages;
    constructor(pipelineName: string);
    addStage(name: string, fn: PipelineStage<TContext>): this;
    run(initialCtx: TContext): Promise<AgenticResult<TContext>>;
}
export interface ApprovalRequest {
    requestId: string;
    toolName: string;
    description: string;
    decisions: AgenticDecision[];
    createdAt: string;
    expiresAt: string;
    status: 'pending' | 'approved' | 'denied';
}
export declare class ApprovalGate {
    private pending;
    /**
     * Submit a request for human approval. Returns the requestId which the
     * dashboard/CLI can use to approve or deny.
     */
    submit(toolName: string, description: string, decisions: AgenticDecision[], ttlMs?: number): string;
    /** Approve a pending request. Returns true if found and approved. */
    approve(requestId: string): boolean;
    /** Deny a pending request. Returns true if found and denied. */
    deny(requestId: string): boolean;
    private recordApprovalProvenance;
    /** Get all pending requests (for dashboard display). */
    listPending(): ApprovalRequest[];
    /** Get a specific request by id. */
    get(requestId: string): ApprovalRequest | undefined;
    /** Clean up expired requests. */
    prune(): number;
}
//# sourceMappingURL=core.d.ts.map