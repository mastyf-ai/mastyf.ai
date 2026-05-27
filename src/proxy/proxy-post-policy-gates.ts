/**
 * Post-policy allow gates shared across proxy transports (sync semantic request).
 */
import type { CallContext, PolicyDecision } from '../policy/policy-types.js';
import { evaluateSyncSemanticRequest } from '../ai/sync-semantic-request.js';
import * as Metrics from '../utils/metrics.js';

export interface PostPolicyGateBlock {
  block: true;
  rule: string;
  reason: string;
  metricCategory: 'semantic_sync_request';
}

export type PostPolicyGateResult = { block: false } | PostPolicyGateBlock;

export async function runSyncSemanticRequestGate(
  context: CallContext,
  decision: PolicyDecision,
  serverName: string,
): Promise<PostPolicyGateResult> {
  const semReq = await evaluateSyncSemanticRequest({ context, policyDecision: decision });
  if (!semReq.block) {
    return { block: false };
  }
  Metrics.semanticSyncRequestBlocksTotal.inc(
    Metrics.withTenantMetricLabels(
      { server_name: serverName },
      context.tenantId,
    ),
  );
  Metrics.recordProxyBlock(
    {
      server_name: serverName,
      block_reason: 'semantic_sync_request',
      rule: semReq.rule,
      tenant_id: context.tenantId,
    },
    'semantic',
  );
  return {
    block: true,
    rule: semReq.rule,
    reason: semReq.reason,
    metricCategory: 'semantic_sync_request',
  };
}
