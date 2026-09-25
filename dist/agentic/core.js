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
import { Logger } from '../utils/logger.js';
import { clearStepUpForRequest } from './zero-trust/step-up-session.js';
export class AgenticResult {
    success;
    data;
    error;
    decisions;
    executionTimeMs;
    constructor(success, data, error, decisions = [], executionTimeMs = 0) {
        this.success = success;
        this.data = data;
        this.error = error;
        this.decisions = decisions;
        this.executionTimeMs = executionTimeMs;
    }
    static ok(data, decisions = [], executionTimeMs = 0) {
        return new AgenticResult(true, data, undefined, decisions, executionTimeMs);
    }
    static fail(error, decisions = []) {
        return new AgenticResult(false, undefined, error, decisions, 0);
    }
    get isSuccess() {
        return this.success;
    }
}
export class AgenticPipeline {
    pipelineName;
    stages = [];
    constructor(pipelineName) {
        this.pipelineName = pipelineName;
    }
    addStage(name, fn) {
        this.stages.push({ name, fn });
        return this;
    }
    async run(initialCtx) {
        const start = Date.now();
        const allDecisions = [];
        let ctx = { ...initialCtx };
        for (const stage of this.stages) {
            try {
                const result = await stage.fn(ctx);
                ctx = result.ctx;
                allDecisions.push(...result.decisions);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                Logger.error(`[AgenticPipeline:${this.pipelineName}] Stage "${stage.name}" failed: ${message}`);
                return AgenticResult.fail(`Pipeline stage "${stage.name}" failed: ${message}`, allDecisions);
            }
        }
        const elapsed = Date.now() - start;
        return AgenticResult.ok(ctx, allDecisions, elapsed);
    }
}
export class ApprovalGate {
    pending = new Map();
    /**
     * Submit a request for human approval. Returns the requestId which the
     * dashboard/CLI can use to approve or deny.
     */
    submit(toolName, description, decisions, ttlMs = 300_000) {
        const requestId = crypto.randomUUID();
        const now = new Date();
        const request = {
            requestId,
            toolName,
            description,
            decisions,
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
            status: 'pending',
        };
        this.pending.set(requestId, request);
        Logger.info(`[ApprovalGate] Awaiting approval for "${toolName}": ${requestId}`);
        return requestId;
    }
    /** Approve a pending request. Returns true if found and approved. */
    approve(requestId) {
        const req = this.pending.get(requestId);
        if (!req || req.status !== 'pending')
            return false;
        req.status = 'approved';
        Logger.info(`[ApprovalGate] Approved: ${requestId}`);
        if (req.toolName === 'zero-trust-step-up') {
            clearStepUpForRequest(requestId);
        }
        void this.recordApprovalProvenance('approval_granted', requestId, req);
        return true;
    }
    /** Deny a pending request. Returns true if found and denied. */
    deny(requestId) {
        const req = this.pending.get(requestId);
        if (!req || req.status !== 'pending')
            return false;
        req.status = 'denied';
        Logger.info(`[ApprovalGate] Denied: ${requestId}`);
        void this.recordApprovalProvenance('approval_denied', requestId, req);
        return true;
    }
    async recordApprovalProvenance(eventType, requestId, req) {
        try {
            const { recordConfigProvenance } = await import('./provenance/config-provenance-chain.js');
            recordConfigProvenance({
                actor: process.env.MASTYF_AI_ACTOR ?? 'approval-gate',
                eventType: 'policy_apply',
                resourcePath: `approval://${req.toolName}`,
                diff: { eventType, toolName: req.toolName, description: req.description },
                approvalId: requestId,
            });
        }
        catch {
            /* best-effort */
        }
    }
    /** Get all pending requests (for dashboard display). */
    listPending() {
        return [...this.pending.values()].filter(r => r.status === 'pending');
    }
    /** Get a specific request by id. */
    get(requestId) {
        return this.pending.get(requestId);
    }
    /** Clean up expired requests. */
    prune() {
        const now = Date.now();
        let pruned = 0;
        for (const [id, req] of this.pending) {
            if (new Date(req.expiresAt).getTime() < now) {
                this.pending.delete(id);
                pruned++;
            }
        }
        return pruned;
    }
}
//# sourceMappingURL=core.js.map