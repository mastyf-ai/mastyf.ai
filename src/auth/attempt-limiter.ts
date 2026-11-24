import type { NextFunction, Request, Response } from 'express';

/**
 * Limits how often one address can try to sign in or set up the dashboard. Password sign-in also
 * locks the account after repeated failures; this covers the API-key and setup paths, which have
 * no account to lock, and slows any guessing from a single machine.
 */
export function createAttemptLimiter(opts: { max: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, number[]>();
  const now = opts.now ?? Date.now;

  function prune(t: number): void {
    if (hits.size < 1000) return;
    for (const [k, list] of hits) if (!list.some((x) => t - x < opts.windowMs)) hits.delete(k);
  }

  return function attemptLimiter(req: Request, res: Response, next: NextFunction): void {
    const t = now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const recent = (hits.get(key) ?? []).filter((x) => t - x < opts.windowMs);
    if (recent.length >= opts.max) {
      const retry = Math.ceil((opts.windowMs - (t - recent[0])) / 1000);
      res.setHeader('Retry-After', String(retry));
      res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(retry / 60)} minute(s).` });
      return;
    }
    recent.push(t);
    hits.set(key, recent);
    prune(t);
    next();
  };
}
