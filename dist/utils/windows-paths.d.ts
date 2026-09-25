/** Escape a path for a PowerShell double-quoted string literal. */
export declare function quotePathForPowerShell(filePath: string): string;
/** Mastyf AI proxy wrapper script for the current platform. */
export declare function resolveMastyfAiProxyWrapper(projectRoot: string): string;
export interface WrappedMcpServerEntry {
    command: string;
    args: string[];
    transport: 'stdio';
    env?: Record<string, string>;
}
/** MCP client JSON entry for a wrapped upstream server (handles paths with spaces). */
export declare function buildWrappedMcpServerEntry(projectRoot: string, singleConfigPath: string, policyPath: string, extraEnv?: Record<string, string>): WrappedMcpServerEntry;
/** Whether a server config already points at Mastyf AI proxy. */
export declare function isMastyfAiProxyCommand(command: string): boolean;
//# sourceMappingURL=windows-paths.d.ts.map