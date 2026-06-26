/**
 * Post-policy allow gates: unified spend reserve + semantic pipeline (all transports).
 */
import { tryReserveSpend, releaseReservedSpend } from '../services/unified-spend-pool.js';
import { getEstimatedSemanticCostUsd } from '../services/tenant-budget.js';
import {
  isSemanticAsyncEnabledForTenant,
  isSyncSemanticRequestLlmEnabledForTenant,
} from '../tenant/tenant-semantic-config.js';
import type { CallContext, PolicyDecision } from '../policy/policy-types.js';
import { flowSessionKey } from '../policy/session-flow-guard.js';
import {
  runSemanticPipelineAfterPolicyAllow,
} from './semantic-proxy-hooks.js';
import type { PostPolicyGateBlock } from './proxy-post-policy-gates.js';

export type { PostPolicyGateBlock };

function estimateUsd(context: CallContext): number {
  const tokens = context.requestTokens ?? 0;
  let usd = tokens <= 0 ? 0.001 : tokens * 0.000002;
  const tenantId = context.tenantId;
  const semanticEstimate = getEstimatedSemanticCostUsd();
  if (semanticEstimate > 0) {
    if (isSyncSemanticRequestLlmEnabledForTenant(tenantId) || isSemanticAsyncEnabledForTenant(tenantId)) {
      usd += semanticEstimate;
    }
  }
  return usd;
}

export type PostPolicyAllowGateOutcome =
  | PostPolicyGateBlock
  | { allowed: true; spendReservationId?: string };

export function isPostPolicyGateBlock(
  outcome: PostPolicyAllowGateOutcome | null | undefined,
): outcome is PostPolicyGateBlock {
  return !!outcome && 'block' in outcome && outcome.block === true;
}

export async function runPostPolicyAllowGates(
  context: CallContext,
  decision: PolicyDecision,
  serverName: string,
): Promise<PostPolicyAllowGateOutcome | null> {
  const estimatedUsd = estimateUsd(context);
  const reserve = await tryReserveSpend({
    tenantId: context.tenantId,
    sessionKey: flowSessionKey(context),
    tokens: context.requestTokens ?? 0,
    estimatedUsd,
  });
  if (!reserve.ok) {
    return {
      block: true,
      rule: reserve.rule ?? 'unified-spend-pool',
      reason: reserve.reason ?? 'Spend cap exceeded',
      metricCategory: 'semantic_sync_request',
    };
  }

  const sem = await runSemanticPipelineAfterPolicyAllow(context, decision, serverName);
  if (sem?.block) {
    await releaseReservedSpend(reserve.reservationId);
    return sem;
  }

  if (reserve.reservationId) {
    return { allowed: true, spendReservationId: reserve.reservationId };
  }
  return null;
}
