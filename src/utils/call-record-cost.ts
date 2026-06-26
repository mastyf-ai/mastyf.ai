import type { IDatabase } from '../database/database-interface.js';
import type { ProxyCallRecord } from '../types.js';
import { getRuntimeModelPricing } from '../services/runtime-model-pricing.js';
import { resolveModelIdForServer } from '../config/llm-config.js';
import * as Metrics from './metrics.js';
import { broadcastDashboardEvent, emitFlowStep } from './dashboard-events.js';
import { enqueueAuditWrite, initAuditWriteQueue } from '../database/audit-write-queue.js';
import { commitSpend, releaseReservedSpend } from '../services/unified-spend-pool.js';

const MAX_BLOCK_REASON_CHARS = parseInt(process.env.MASTYF_AI_AUDIT_MAX_BLOCK_REASON_CHARS || '4096', 10);

/** Trim oversized audit fields before queue/DB write (L-2). */
export function compactCallRecordForPersistence(record: ProxyCallRecord): ProxyCallRecord {
  const maxReason = Number.isFinite(MAX_BLOCK_REASON_CHARS) && MAX_BLOCK_REASON_CHARS > 0
    ? MAX_BLOCK_REASON_CHARS
    : 4096;
  if (!record.blockReason || record.blockReason.length <= maxReason) {
    return record;
  }
  return {
    ...record,
    blockReason: `${record.blockReason.slice(0, maxReason)}…[truncated]`,
  };
}

function estimateReservedUsd(requestTokens: number): number {
  const tokens = requestTokens ?? 0;
  if (tokens <= 0) return 0.001;
  return tokens * 0.000002;
}

export async function commitSpendFromRecord(record: ProxyCallRecord): Promise<void> {
  const costUsd = record.costUsd ?? 0;
  if (costUsd > 0 && record.spendReservationId) {
    await commitSpend(record.spendReservationId, record.tenantId, costUsd);
  } else if (costUsd > 0) {
    const { recordActualSpend } = await import('../services/unified-spend-pool.js');
    await recordActualSpend(record.tenantId, costUsd, estimateReservedUsd(record.requestTokens));
  }
}

export async function releaseSpendReservation(reservationId?: string): Promise<void> {
  await releaseReservedSpend(reservationId);
}

export async function enrichCallRecord(
  record: ProxyCallRecord,
  msg?: unknown,
  serverEnv?: Record<string, string>,
  serverArgs?: string[],
): Promise<ProxyCallRecord> {
  const pricing = getRuntimeModelPricing();
  const cost = await pricing.computeCostForCall(record.requestTokens, record.responseTokens, msg);
  const fallbackModel = resolveModelIdForServer(record.serverName, serverEnv, serverArgs);
  const model = cost.model || fallbackModel;

  let costUsd = cost.priced ? cost.costUsd : 0;
  let pricingSource = cost.source;

  if (costUsd <= 0 && model && (record.requestTokens + record.responseTokens) > 0) {
    const resolved = await pricing.resolveModelId(model);
    if (resolved) {
      const recomputed = pricing.computeCost(record.requestTokens, record.responseTokens, resolved);
      if (recomputed.priced) {
        costUsd = recomputed.costUsd;
        pricingSource = recomputed.source;
      }
    }
  }

  return {
    ...record,
    model,
    costUsd,
    pricingSource,
  };
}

export async function persistCallRecord(
  db: IDatabase,
  record: ProxyCallRecord,
  msg?: unknown,
  serverEnv?: Record<string, string>,
  serverArgs?: string[],
): Promise<ProxyCallRecord> {
  initAuditWriteQueue(db);
  const enriched = compactCallRecordForPersistence(
    await enrichCallRecord(record, msg, serverEnv, serverArgs),
  );
  const costJob =
    enriched.costUsd && enriched.costUsd > 0
      ? {
          serverName: enriched.serverName,
          tokens: enriched.totalTokens,
          costUsd: enriched.costUsd,
          tenantId: enriched.tenantId ?? 'default',
        }
      : undefined;

  enqueueAuditWrite({ record: enriched, costRecord: costJob });
  if (enriched.costUsd && enriched.costUsd > 0) {
    void commitSpendFromRecord(enriched);
  }

  broadcastDashboardEvent({
    type: enriched.blocked ? 'policy-block' : 'audit:decision',
    serverName: enriched.serverName,
    payload: {
      toolName: enriched.toolName,
      blocked: !!enriched.blocked,
      blockRule: enriched.blockRule,
      blockReason: enriched.blockReason,
      totalTokens: enriched.totalTokens,
      costUsd: enriched.costUsd,
    },
    timestamp: Date.now(),
  });

  const rule = enriched.blockRule || '—';
  const reasonShort = (enriched.blockReason || '').slice(0, 120);
  emitFlowStep({
    kind: enriched.blocked ? 'policy_block' : 'policy_pass',
    title: enriched.blocked ? `Blocked ${enriched.toolName}` : `Allowed ${enriched.toolName}`,
    summary: enriched.blocked
      ? `${rule}${reasonShort ? `: ${reasonShort}` : ''}`
      : `${enriched.totalTokens} tokens`,
    severity: enriched.blocked ? 'warn' : 'success',
    serverName: enriched.serverName,
    toolName: enriched.toolName,
    metadata: {
      blockRule: enriched.blockRule,
      costUsd: enriched.costUsd,
      totalTokens: enriched.totalTokens,
    },
  });

  if (enriched.costUsd && enriched.costUsd > 0) {
    Metrics.tokenCostUsd.observe(
      { server_name: enriched.serverName, model: enriched.model || 'unknown' },
      enriched.costUsd,
    );
    Metrics.recordCostSpendUsd(enriched.costUsd, enriched.tenantId);
  }
  return enriched;
}
