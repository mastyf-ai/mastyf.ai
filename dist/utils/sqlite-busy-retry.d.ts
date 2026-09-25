export declare function isSqliteBusyError(err: unknown): boolean;
/** Retry synchronous/async DB writes on SQLITE_BUSY (exponential backoff, 3 attempts). */
export declare function withSqliteBusyRetry<T>(fn: () => Promise<T> | T, attempts?: number): Promise<T>;
//# sourceMappingURL=sqlite-busy-retry.d.ts.map