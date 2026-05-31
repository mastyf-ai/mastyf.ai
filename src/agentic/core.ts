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

// ── Result types ──────────────────────────────────────────────────────────

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

export class AgenticResult<T = unknown> {
  constructor(
    public readonly success: boolean,
    public readonly data?: T,
    public readonly error?: string,
    public readonly decisions: AgenticDecision[] = [],
    public readonly executionTimeMs: number = 0,
  ) {}

  static ok<T>(data: T, decisions: AgenticDecision[] = [], executionTimeMs = 0): AgenticResult<T> {
    return new AgenticResult(true, data, undefined, decisions, executionTimeMs);
  }

  static fail<T>(error: string, decisions: AgenticDecision[] = []): AgenticResult<T> {
    return new AgenticResult(false, undefined as unknown as T, error, decisions, 0);
  }

  get isSuccess(): boolean {
    return this.success;
  }
}

// ── Agentic tool interface ────────────────────────────────────────────────

export interface IAgenticTool {
  readonly toolName: string;
  execute(args: Record<string, unknown>): Promise<AgenticResult>;
}

// ── Agentic pipeline ──────────────────────────────────────────────────────

export type PipelineStage<TContext = Record<string, unknown>> = (
  ctx: TContext,
) => Promise<{ ctx: TContext; decisions: AgenticDecision[] }>;

export class AgenticPipeline<TContext = Record<string, unknown>> {
  private stages: { name: string; fn: PipelineStage<TContext> }[] = [];

  constructor(public readonly pipelineName: string) {}

  addStage(name: string, fn: PipelineStage<TContext>): this {
    this.stages.push({ name, fn });
    return this;
  }

  async run(initialCtx: TContext): Promise<AgenticResult<TContext>> {
    const start = Date.now();
    const allDecisions: AgenticDecision[] = [];
    let ctx = { ...initialCtx };

    for (const stage of this.stages) {
      try {
        const result = await stage.fn(ctx);
        ctx = result.ctx;
        allDecisions.push(...result.decisions);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error(`[AgenticPipeline:${this.pipelineName}] Stage "${stage.name}" failed: ${message}`);
        return AgenticResult.fail<TContext>(
          `Pipeline stage "${stage.name}" failed: ${message}`,
          allDecisions,
        );
      }
    }

    const elapsed = Date.now() - start;
    return AgenticResult.ok(ctx, allDecisions, elapsed);
  }
}

// ── Approval gate (human-in-the-loop) ─────────────────────────────────────

export interface ApprovalRequest {
  requestId: string;
  toolName: string;
  description: string;
  decisions: AgenticDecision[];
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'denied';
}

export class ApprovalGate {
  private pending = new Map<string, ApprovalRequest>();

  /**
   * Submit a request for human approval. Returns the requestId which the
   * dashboard/CLI can use to approve or deny.
   */
  submit(toolName: string, description: string, decisions: AgenticDecision[], ttlMs = 300_000): string {
    const requestId = crypto.randomUUID();
    const now = new Date();
    const request: ApprovalRequest = {
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
  approve(requestId: string): boolean {
    const req = this.pending.get(requestId);
    if (!req || req.status !== 'pending') return false;
    req.status = 'approved';
    Logger.info(`[ApprovalGate] Approved: ${requestId}`);
    if (req.toolName === 'zero-trust-step-up') {
      clearStepUpForRequest(requestId);
    }
    void this.recordApprovalProvenance('approval_granted', requestId, req);
    return true;
  }

  /** Deny a pending request. Returns true if found and denied. */
  deny(requestId: string): boolean {
    const req = this.pending.get(requestId);
    if (!req || req.status !== 'pending') return false;
    req.status = 'denied';
    Logger.info(`[ApprovalGate] Denied: ${requestId}`);
    void this.recordApprovalProvenance('approval_denied', requestId, req);
    return true;
  }

  private async recordApprovalProvenance(
    eventType: 'approval_granted' | 'approval_denied',
    requestId: string,
    req: ApprovalRequest,
  ): Promise<void> {
    try {
      const { recordConfigProvenance } = await import('./provenance/config-provenance-chain.js');
      recordConfigProvenance({
        actor: process.env.GUARDIAN_ACTOR ?? 'approval-gate',
        eventType: 'policy_apply',
        resourcePath: `approval://${req.toolName}`,
        diff: { eventType, toolName: req.toolName, description: req.description },
        approvalId: requestId,
      });
    } catch {
      /* best-effort */
    }
  }

  /** Get all pending requests (for dashboard display). */
  listPending(): ApprovalRequest[] {
    return [...this.pending.values()].filter(r => r.status === 'pending');
  }

  /** Get a specific request by id. */
  get(requestId: string): ApprovalRequest | undefined {
    return this.pending.get(requestId);
  }

  /** Clean up expired requests. */
  prune(): number {
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