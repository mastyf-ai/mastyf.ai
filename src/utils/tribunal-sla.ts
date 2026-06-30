/**
 * Tribunal human-review SLA — timeout actions for pending semantic audit records (M-016).
 */
import { Logger } from './logger.js';
import { broadcastDashboardEvent } from './dashboard-events.js';
import { getTribunalPolicyFromConfig } from '../policy/tribunal-policy.js';
import { loadSemanticAuditRecordsAsync } from '../ai/semantic-audit-store.js';

export type TribunalTimeoutAction = 'block' | 'allow' | 'escalate-to-oncall';

export function getTribunalTimeoutMs(): number {
  const envRaw = process.env['MASTYF_AI_TRIBUNAL_TIMEOUT_MS'];
  if (envRaw) {
    const n = parseInt(envRaw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fromPolicy = getTribunalPolicyFromConfig()?.timeout_ms;
  if (fromPolicy && fromPolicy > 0) return fromPolicy;
  return 4 * 60 * 60 * 1000;
}

export function getTribunalTimeoutAction(): TribunalTimeoutAction {
  const envRaw = process.env['MASTYF_AI_TRIBUNAL_TIMEOUT_ACTION'];
  if (envRaw) {
    const v = envRaw.toLowerCase();
    if (v === 'allow' || v === 'escalate-to-oncall') return v;
    return 'block';
  }
  const fromPolicy = getTribunalPolicyFromConfig()?.timeout_action;
  if (fromPolicy) return fromPolicy;
  return 'block';
}

export async function countPendingTribunalRecords(): Promise<number> {
  try {
    const { loadSemanticAuditRecordsAsync } = await import('../ai/semantic-audit-store.js');
    const records = await loadSemanticAuditRecordsAsync({ limit: 500 });
    return records.filter(
      (r: { semanticAudit: { suspicious: boolean }; label?: string; labeled?: boolean }) =>
        r.semanticAudit.suspicious && !r.label && !r.labeled,
    ).length;
  } catch {
    return 0;
  }
}

export async function sweepTribunalTimeouts(): Promise<{ processed: number; action: TribunalTimeoutAction }> {
  const action = getTribunalTimeoutAction();
  const timeoutMs = getTribunalTimeoutMs();
  const cutoff = Date.now() - timeoutMs;
  let processed = 0;

  try {
    const { loadSemanticAuditRecordsAsync, labelSemanticAuditRecord } = await import('../ai/semantic-audit-store.js');
    const records = await loadSemanticAuditRecordsAsync({ limit: 500 });
    for (const rec of records) {
      if (!rec.semanticAudit.suspicious || rec.label || rec.labeled) continue;
      const ts = Date.parse(rec.timestamp);
      if (!Number.isFinite(ts) || ts > cutoff) continue;
      processed += 1;
      if (action === 'allow') {
        await labelSemanticAuditRecord(rec.id, 'false_positive', 'tribunal-sla-timeout');
      } else if (action === 'block') {
        await labelSemanticAuditRecord(rec.id, 'true_positive', 'tribunal-sla-timeout');
      } else {
        broadcastDashboardEvent({
          type: 'logs:alert',
          payload: {
            severity: 'critical',
            code: 'tribunal_sla_breach',
            recordId: rec.id,
            toolName: rec.toolName,
          },
          timestamp: Date.now(),
        });
        Logger.warn(`[tribunal-sla] Escalated overdue record ${rec.id} (${rec.toolName})`);
      }
    }
  } catch (err: unknown) {
    Logger.debug(`[tribunal-sla] sweep error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { processed, action };
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startTribunalSlaSweep(intervalMs = 60_000): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void sweepTribunalTimeouts();
  }, intervalMs);
  sweepTimer.unref?.();
}

export function stopTribunalSlaSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
