export type AuthDbRow = Record<string, unknown>;
export interface AuthDbAdapter {
    readonly dialect: 'sqlite' | 'postgres';
    init(): Promise<void>;
    get(sql: string, params?: unknown[]): Promise<AuthDbRow | undefined>;
    all(sql: string, params?: unknown[]): Promise<AuthDbRow[]>;
    run(sql: string, params?: unknown[]): Promise<{
        changes: number;
    }>;
    newId(): string;
    /** ISO-8601 timestamp for "now", used consistently across both backends. */
    nowIso(): string;
}
/** Get (and lazily initialize) the process-wide auth DB adapter. */
export declare function getAuthDb(): Promise<AuthDbAdapter>;
/** Test-only hook to reset the singleton between test suites. */
export declare function __resetAuthDbForTests(): void;
//# sourceMappingURL=auth-db.d.ts.map