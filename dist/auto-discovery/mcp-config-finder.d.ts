/**
 * MCP Configuration Auto-Discovery Finder
 *
 * Scans standard developer workstation paths to automatically discover
 * and onboard MCP server configurations from:
 *   - Cursor (~/.cursor/mcp.json)
 *   - Claude Desktop (macOS / Linux / Windows config locations)
 *   - Cline (~/.config/cline/mcp_config.json)
 *   - Windsurf (~/.windsurf/mcp.json)
 *   - VS Code (.vscode/mcp.json)
 */
export interface DiscoveredMcpServer {
    name: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    transport?: 'stdio' | 'http' | 'sse' | 'ws';
    url?: string;
}
export interface DiscoveredClientConfig {
    client: 'Cursor' | 'Claude Desktop' | 'Cline' | 'Windsurf' | 'VS Code' | 'Custom';
    configPath: string;
    servers: DiscoveredMcpServer[];
}
export declare class McpConfigFinder {
    /**
     * Returns a list of candidate config paths across supported AI agent clients.
     */
    getCandidatePaths(): Array<{
        client: DiscoveredClientConfig['client'];
        configPath: string;
    }>;
    /**
     * Parses an MCP client configuration file into standardized server entries.
     */
    parseConfigFile(client: DiscoveredClientConfig['client'], configPath: string): DiscoveredClientConfig | null;
    /**
     * Discovers all active MCP client configurations on the host machine.
     */
    discoverAll(): DiscoveredClientConfig[];
}
export declare const globalMcpConfigFinder: McpConfigFinder;
//# sourceMappingURL=mcp-config-finder.d.ts.map