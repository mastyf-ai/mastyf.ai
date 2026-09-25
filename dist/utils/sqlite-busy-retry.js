const BUSY_DELAYS_MS = [50, 150, 400];
export function isSqliteBusyError(err) {
    if (!err || typeof err !== 'object')
        return false;
    const code = err.code;
    return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
}
/** Retry synchronous/async DB writes on SQLITE_BUSY (exponential backoff, 3 attempts). */
export async function withSqliteBusyRetry(fn, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            if (!isSqliteBusyError(err) || i >= attempts - 1)
                throw err;
            const delay = BUSY_DELAYS_MS[i] ?? BUSY_DELAYS_MS[BUSY_DELAYS_MS.length - 1];
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastErr;
}
//# sourceMappingURL=sqlite-busy-retry.js.map