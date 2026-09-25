import type { CallContext, PolicyDecision } from './policy-types.js';
/**
 * Semantic abuse checks (paths, SQL exfil, GitHub repo scope, PowerShell, SSTI).
 * All guards scan every string leaf via `walkStringLeaves`. Prompt injection on
 * requests is handled in PolicyEngine via `scanToolCallArguments` (full rule set).
 */
export declare function evaluateSemanticGuards(ctx: CallContext, rawArguments?: Record<string, unknown> | null): PolicyDecision | null;
//# sourceMappingURL=semantic-guards.d.ts.map