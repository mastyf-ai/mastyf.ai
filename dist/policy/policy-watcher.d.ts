import { PolicyEngine } from './policy-engine.js';
/**
 * Hot-reloadable policy engine wrapper.
 * Builds a new PolicyEngine off the event-loop critical path, then swaps after in-flight
 * evaluations complete (M-003). On validation failure during reload, retains the prior
 * engine and emits policy_load_error metrics (M-012).
 */
export declare class PolicyWatcher {
    private current;
    private pendingEngine;
    private evalInflight;
    private watcher;
    private policyPath;
    private reloadTimer;
    private reloadInFlight;
    private loadedPolicyVersion;
    /** Callback invoked after a successful hot-reload (set by ProxyManager) */
    onReload: (() => void) | null;
    constructor(policyPath: string);
    /** Synchronous initial load only — subsequent reloads are debounced + async. */
    private loadPolicySync;
    private buildEngineFromDisk;
    private waitForEvalDrain;
    /** Pin active engine for evaluation — defers hot-swap until drain (M-003). */
    pinEngineForEval(): PolicyEngine | null;
    unpinEngineForEval(): void;
    withEngineAsync<T>(fn: (engine: PolicyEngine) => Promise<T>): Promise<T | null>;
    private scheduleReload;
    private reloadPolicyAsync;
    /** Apply a YAML string from a remote source (e.g., control plane) without writing to disk. */
    reloadFromYamlString(yaml: string): boolean;
    getPolicyVersion(): string;
    private startWatching;
    /**
     * Get the current (active) policy engine.
     * Always the latest successfully loaded version; never null after initial load.
     */
    get(): PolicyEngine | null;
    /** Force reload from disk (e.g. after cloud policy sync write). */
    reloadNow(): Promise<void>;
    /** @internal — deterministic reload for tests (skips chokidar debounce). */
    forceReloadForTests(): Promise<void>;
    close(): void;
}
//# sourceMappingURL=policy-watcher.d.ts.map