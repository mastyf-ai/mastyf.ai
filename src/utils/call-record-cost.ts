import type { IDatabase } from '../database/database-interface.js';
import type { ProxyCallRecord } from '../types.js';

const MAX_BLOCK_REASON_CHARS = parseInt(process.env.GUARDIAN_AUDIT_MAX_BLOCK_REASON_CHARS || '4096', 10);

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
import { getRuntimeModelPricing } from '../services/runtime-model-pricing.js';
import { resolveModelIdForServer } from '../config/llm-config.js';
import * as Metrics from './metrics.js';
import { broadcastDashboardEvent } from './dashboard-events.js';
import { enqueueAuditWrite, initAuditWriteQueue } from '../database/audit-write-queue.js';

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

  if (enriched.costUsd && enriched.costUsd > 0) {
    Metrics.tokenCostUsd.observe(
      { server_name: enriched.serverName, model: enriched.model || 'unknown' },
      enriched.costUsd,
    );
  }
  return enriched;
}
