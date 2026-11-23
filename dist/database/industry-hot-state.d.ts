export type HotTable = 'mcp_certifications' | 'behavior_fingerprints' | 'intent_bindings' | 'sandbox_tier_state' | 'agent_reputation' | 'mtx_signatures';
export type HotRow = Record<string, unknown>;
/** Primary key columns per table, used to key rows in memory and to upsert. */
export declare const HOT_TABLE_KEYS: Record<HotTable, string[]>;
export interface IndustryHotSnapshot {
    certifications: HotRow[];
    behaviorFingerprints: HotRow[];
    intentBindings: HotRow[];
    sandboxTiers: HotRow[];
    agentReputations: HotRow[];
    mtxSignatures: HotRow[];
}
/**
 * Async persistence for the hot tables. Implemented once per dialect; the cache
 * itself has no SQL.
 */
export interface IndustryHotBackend {
    readonly dialect: 'sqlite' | 'postgres';
    /** Create tables if absent. Must be idempotent. */
    ensureSchema(): Promise<void>;
    loadAll(tenantId: string): Promise<IndustryHotSnapshot>;
    upsert(table: HotTable, row: HotRow): Promise<void>;
}
export interface IndustryHotStats {
    hydrated: boolean;
    dialect: string | null;
    lastRefreshMs: number | null;
    lastError: string | null;
    queuedWrites: number;
    persistedWrites: number;
    droppedWrites: number;
    rowCounts: Record<string, number>;
}
declare function tenantOf(row: HotRow): string;
export declare class IndustryHotState {
    private backend;
    private snapshot;
    private maps;
    private queue;
    private draining;
    private timer;
    private drainTimer;
    private lastRefreshMs;
    private lastError;
    private persistedWrites;
    private droppedWrites;
    get enabled(): boolean;
    get hydrated(): boolean;
    get lastErrorMessage(): string | null;
    stats(): IndustryHotStats;
    /** Create the hot tables if absent. No-op when no backend is attached. */
    ensureSchema(): Promise<void>;
    /** Bind a backend. Not yet hydrated -- reads fall through until `refresh()`. */
    attach(backend: IndustryHotBackend): void;
    detach(): void;
    /**
     * Load the snapshot. On failure the previous snapshot is retained rather than
     * cleared: dropping to empty would make every agentic read return null and
     * turn the strategies into a blanket deny.
     */
    refresh(tenantId?: string): Promise<boolean>;
    /** `mcp_certifications` keeps only the newest row per server, as `getCertification` does. */
    private index;
    getCertification(serverName: string): HotRow | null;
    getBehaviorFingerprint(agentId: string): HotRow | null;
    getIntentBinding(sessionId: string): HotRow | null;
    getSandboxTier(scopeType: string, scopeId: string): HotRow | null;
    getAgentReputation(agentId: string): HotRow | null;
    /**
     * Every cached row for a table, for the control-plane readers (status,
     * listings). Returns a copy so callers cannot mutate the cache.
     */
    rows(table: HotTable): HotRow[];
    /**
     * Update the snapshot immediately and queue the durable write. Returns false
     * when no backend is attached, in which case the caller keeps using its
     * existing synchronous path.
     */
    enqueue(table: HotTable, row: HotRow): boolean;
    /**
     * Batch writes to a durable store quickly rather than waiting for the refresh
     * tick. Without this, a crash can lose every write made since the last
     * refresh -- which for a certification or reputation change is exactly the
     * window an attacker would aim for.
     *
     * MASTYF_AI_INDUSTRY_DEBOUNCE_MS trades write amplification against the
     * crash window. Shutdown flushes synchronously regardless.
     */
    private scheduleDrain;
    drain(): Promise<void>;
    startRefresh(tenantId?: string): void;
    stopRefresh(): void;
    /** Best-effort drain for shutdown. */
    shutdown(): Promise<void>;
}
export declare function getIndustryHotState(): IndustryHotState;
/** Test seam. */
export declare function __resetIndustryHotState(): void;
export { tenantOf };
//# sourceMappingURL=industry-hot-state.d.ts.map