export type ToolListEntry = {
    name?: string;
    description?: string;
    inputSchema?: unknown;
};
export type ToolFingerprintState = {
    fingerprint: string | null;
    blocked: boolean;
};
export declare function canonicalizeToolsList(tools: ToolListEntry[]): string;
export declare function hashToolsFromResult(result: unknown): string | null;
export type RugPullMismatchHandler = (ctx: {
    serverName: string;
    tenantId: string;
    previousFingerprint: string;
    currentFingerprint: string;
    toolCount: number;
}) => void | Promise<void>;
/**
 * Update fingerprint from a tools/list payload (JSON-RPC response or notification).
 * Returns true if a new rug-pull mismatch was detected this call.
 */
/** Persist last tools/list (with inputSchema) for AI Access / discovery — not invented. */
export declare function persistToolManifest(serverName: string, tools: ToolListEntry[]): void;
export type ResourceListEntry = {
    uri?: string;
    name?: string;
    description?: string;
    mimeType?: string;
};
/** Persist last resources/list for AI Access — never invent URIs. */
export declare function persistResourceManifest(serverName: string, resources: ResourceListEntry[]): void;
export declare function applyToolFingerprint(state: ToolFingerprintState, tools: ToolListEntry[], ctx: {
    serverName: string;
    tenantId: string;
    logPrefix?: string;
    onMismatch?: RugPullMismatchHandler;
    /** Skip Logger/metrics/persist noise (e.g. corpus simulation). */
    quiet?: boolean;
}): boolean;
export declare function applyToolFingerprintFromResult(state: ToolFingerprintState, result: unknown, ctx: Parameters<typeof applyToolFingerprint>[2]): boolean;
//# sourceMappingURL=tool-fingerprint.d.ts.map