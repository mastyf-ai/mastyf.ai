export type WrapClient = 'cline' | 'cursor' | 'claude-desktop' | 'windsurf' | 'auto';
export interface WrapOptions {
    client: WrapClient;
    configPath?: string;
    /** Package root with dist/cli.js and proxy wrapper scripts */
    projectRoot: string;
    /** Where mastyf-ai-configs/ and examples/ are written (default: projectRoot) */
    workspaceRoot?: string;
    policyPath: string;
    apply: boolean;
    skipNames?: string[];
    /** Run the proxy with this node binary directly, for agents launched with no usable PATH. */
    nodeCommand?: string;
    /** With nodeCommand: makes per-server file names unique per agent. */
    fileKey?: string;
}
export interface WrapResult {
    clientConfigPath: string;
    backupPath?: string;
    configsDir: string;
    wrapped: string[];
    skipped: string[];
    wrapperScript: string;
}
export declare function resolveClientConfigPath(client: WrapClient, explicit?: string): string | null;
/** Per-server config name for `connect`: agents can share a server name, and names can sanitise alike. */
export declare function managedConfigFileName(agentKey: string, serverName: string): string;
export declare function sanitizeFileName(name: string): string;
export declare function extractServers(raw: Record<string, unknown>): Record<string, Record<string, unknown>>;
export declare function setServers(raw: Record<string, unknown>, servers: Record<string, Record<string, unknown>>): void;
export declare function runWrap(opts: WrapOptions): WrapResult;
export interface LocalUrlPatchEntry {
    name: string;
    localUrl: string;
}
/**
 * Patch IDE MCP config so fleet servers use local HTTP URLs (Fleet Hub mode).
 */
export declare function patchClientToLocalUrls(opts: {
    client: WrapClient;
    configPath?: string;
    entries: LocalUrlPatchEntry[];
    apply: boolean;
    skipNames?: string[];
}): {
    clientConfigPath: string;
    backupPath?: string;
    patched: string[];
};
export declare function patchClientServerToLocalUrl(opts: {
    client: WrapClient;
    configPath?: string;
    name: string;
    localUrl: string;
    apply: boolean;
}): {
    clientConfigPath: string;
    backupPath?: string;
};
//# sourceMappingURL=client-wrap.d.ts.map