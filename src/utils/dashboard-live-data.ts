/** Shared shapes for dashboard APIs — no synthetic metrics when live data is missing. */

export type LiveDataEnvelope<T> = T & {
  available: boolean;
  error?: string;
};

export function unavailable<T extends Record<string, unknown>>(
  partial: T,
  error: string,
): LiveDataEnvelope<T> {
  return { ...partial, available: false, error };
}

export function available<T extends Record<string, unknown>>(data: T): LiveDataEnvelope<T> {
  return { ...data, available: true };
}

export function isDemoThreatId(id: string): boolean {
  return /TEST\d/i.test(id) || id.startsWith('CVE-2026-TEST');
}

export function defaultPolicyPath(): string {
  return (
    process.env.GUARDIAN_POLICY_PATH
    || process.env.MCP_GUARDIAN_POLICY_PATH
    || 'default-policy.yaml'
  );
}

export function parseCostBudgetUsd(): number | null {
  const raw = process.env.GUARDIAN_COST_BUDGET_USD;
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
