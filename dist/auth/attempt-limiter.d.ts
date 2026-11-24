import type { NextFunction, Request, Response } from 'express';
/**
 * Limits how often one address can try to sign in or set up the dashboard. Password sign-in also
 * locks the account after repeated failures; this covers the API-key and setup paths, which have
 * no account to lock, and slows any guessing from a single machine.
 */
export declare function createAttemptLimiter(opts: {
    max: number;
    windowMs: number;
    now?: () => number;
}): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=attempt-limiter.d.ts.map