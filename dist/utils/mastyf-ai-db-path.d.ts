/** Canonical SQLite path for all Mastyf AI processes (proxy, TUI, scan, audit). */
export declare function resolveMastyfAiDbPath(explicit?: string): string;
export declare function getDefaultMastyfAiDbPath(): string;
/**
 * MCP stdio server DB (Cline cannot pass env) — separate file from proxy history to avoid locks.
 */
export declare function resolveMcpServerDbPath(): string;
//# sourceMappingURL=mastyf-ai-db-path.d.ts.map