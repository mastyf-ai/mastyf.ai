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