/**
 * Heuristics for PgBouncer vs direct Postgres URLs at startup.
 * See docs/SCALE_AND_RESILIENCE.md (100-replica chaos test).
 */
export declare function isPgbouncerConnectionUrl(databaseUrl: string | undefined): boolean;
export declare function isDirectPostgresUrl(databaseUrl: string | undefined): boolean;
export interface PgBouncerStartupContext {
    dbType: string;
    databaseUrl?: string;
    replicaCount: number;
    inK8s: boolean;
    redisConfigured: boolean;
    strictMode: boolean;
    requirePgBouncer: boolean;
}
export type PgBouncerCheckResult = {
    action: 'none';
} | {
    action: 'warn';
    message: string;
} | {
    action: 'error';
    message: string;
};
export declare function evaluatePgBouncerStartup(ctx: PgBouncerStartupContext): PgBouncerCheckResult;
export declare function checkPgBouncerAtStartup(): void;
//# sourceMappingURL=pgbouncer-check.d.ts.map