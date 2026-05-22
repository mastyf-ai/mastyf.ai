import type { Redis } from 'ioredis';
import { Redis as IORedis } from 'ioredis';
import { Logger } from '../utils/logger.js';

/** Jittered backoff for lock contention (L-4 / H-3). */
export function retryDelayWithJitter(attempt: number, baseMs: number): number {
  const exponential = baseMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * Math.min(exponential * 0.25, 50));
  return exponential + jitter;
}

export function parseQuorumRedisUrls(): string[] {
  const raw = process.env['GUARDIAN_DPOP_QUORUM_REDIS']?.trim();
  if (!raw) return [];
  return raw.split(',').map((u) => u.trim()).filter(Boolean);
}

/**
 * Multi-Redis quorum jti claim (Redlock-style majority) for active-active regions.
 * Requires GUARDIAN_DPOP_QUORUM_REDIS=redis://a,redis://b,redis://c
 */
export async function claimDpopJtiQuorum(
  clients: Array<Pick<Redis, 'set' | 'get' | 'del'>>,
  keyPrefix: string,
  jti: string,
  ttlSeconds: number,
  tenantId: string,
): Promise<boolean> {
  if (clients.length === 0) return false;
  const scopedPrefix = `${keyPrefix}tenant:${tenantId}:`;
  const lockKey = `${scopedPrefix}lock:${jti}`;
  const dataKey = `${scopedPrefix}${jti}`;
  const quorum = Math.floor(clients.length / 2) + 1;
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const lockVotes = await Promise.all(
      clients.map((c) => c.set(lockKey, '1', 'EX', 1, 'NX')),
    );
    if (lockVotes.filter((v) => v === 'OK').length < quorum) {
      await sleep(retryDelayWithJitter(attempt, 10));
      continue;
    }

    try {
      const existing = await Promise.all(clients.map((c) => c.get(dataKey)));
      if (existing.some((v) => v !== null)) return false;

      const claims = await Promise.all(
        clients.map((c) => c.set(dataKey, '1', 'EX', ttlSeconds, 'NX')),
      );
      const successes = claims.filter((v) => v === 'OK').length;
      if (successes >= quorum) return true;

      await Promise.all(clients.map((c) => c.del(dataKey).catch(() => 0)));
      return false;
    } finally {
      await Promise.all(clients.map((c) => c.del(lockKey).catch(() => 0)));
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let quorumClients: Redis[] | null = null;

export function resetDpopQuorumClientsForTests(): void {
  quorumClients = null;
}

export async function getDpopQuorumClients(): Promise<Redis[]> {
  if (quorumClients) return quorumClients;
  const urls = parseQuorumRedisUrls();
  if (urls.length === 0) return [];
  quorumClients = urls.map(
    (url) =>
      new IORedis(url, {
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      }),
  );
  Logger.info(`[dpop] Quorum nonce store (${urls.length} Redis nodes, quorum=${Math.floor(urls.length / 2) + 1})`);
  return quorumClients;
}
