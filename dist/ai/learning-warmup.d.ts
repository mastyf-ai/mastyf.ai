/**
 * OPTIONAL DEMO/DEV UTILITY — NOT part of normal startup.
 *
 * When explicitly enabled (MASTYF_AI_LEARNING_WARMUP=true|force), seeds
 * learning + semantic audit state from bundled corpus attack fixtures so the
 * SOC AI Learning dashboard has something to show in a demo environment.
 *
 * This must stay OPT-IN. A fresh installation must start with a genuinely
 * empty history/learning state — no fabricated call records, no synthetic
 * "prompt injection detected" audit entries. Do not flip this default back
 * to enabled without also updating the fresh-install expectations.
 */
import type { IDatabase } from '../database/database-interface.js';
import type { McpServerConfig } from '../types.js';
import type { PolicyEngine } from '../policy/policy-engine.js';
export type LearningWarmupResult = {
    seeded: number;
    semanticRecords: number;
    skipped: boolean;
    reason?: string;
};
/** Opt-in only. Fresh installs and default `mastyf-ai start` runs must NOT seed demo data. */
export declare function isLearningWarmupEnabled(): boolean;
/** Populate call history + async semantic audits from corpus attack fixtures. */
export declare function maybeRunLearningWarmup(opts: {
    db: IDatabase;
    servers: McpServerConfig[];
    policyEngine?: PolicyEngine | null;
    tenantId?: string;
}): Promise<LearningWarmupResult>;
//# sourceMappingURL=learning-warmup.d.ts.map