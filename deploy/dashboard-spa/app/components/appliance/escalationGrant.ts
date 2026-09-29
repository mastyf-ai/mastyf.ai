/** Keep in sync with src/dashboard/escalation-grant.ts — grants never last forever. */

export const ALLOW_ONCE_TTL_SECONDS = 3600;
export const ALLOW_ALWAYS_TTL_SECONDS = 90 * 86400;
export const BLOCK_TTL_SECONDS = 30 * 86400;
export const BLOCK_PERMANENT_TTL_SECONDS = 90 * 86400;

export type EscalationResolveAction =
  | 'allow_once'
  | 'tool'
  | 'allow_always'
  | 'block'
  | 'quarantine'
  | 'block_permanently'
  | 'similar'
  | 'session'
  | 'destination';

export function escalationAllowOnceBody(receiptId: string): {
  receipt_id: string;
  action: 'allow_once';
  confirmation: true;
  ttl_seconds: number;
} {
  return {
    receipt_id: receiptId,
    action: 'allow_once',
    confirmation: true,
    ttl_seconds: ALLOW_ONCE_TTL_SECONDS,
  };
}

export function escalationAllowAlwaysBody(receiptId: string): {
  receipt_id: string;
  action: 'allow_always';
  confirmation: true;
  ttl_seconds: number;
} {
  return {
    receipt_id: receiptId,
    action: 'allow_always',
    confirmation: true,
    ttl_seconds: ALLOW_ALWAYS_TTL_SECONDS,
  };
}

export function escalationBlockBody(receiptId: string): {
  receipt_id: string;
  action: 'block';
  confirmation: true;
  ttl_seconds: number;
} {
  return {
    receipt_id: receiptId,
    action: 'block',
    confirmation: true,
    ttl_seconds: BLOCK_TTL_SECONDS,
  };
}

export function escalationBlockPermanentlyBody(receiptId: string): {
  receipt_id: string;
  action: 'block_permanently';
  confirmation: true;
  ttl_seconds: number;
} {
  return {
    receipt_id: receiptId,
    action: 'block_permanently',
    confirmation: true,
    ttl_seconds: BLOCK_PERMANENT_TTL_SECONDS,
  };
}

export function gatewayErrorMessage(
  result: Record<string, unknown>,
  fallback: string,
): string {
  const parts = [result.error, result.reason, result.detail, result.message]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  return parts.join(' — ') || fallback;
}
