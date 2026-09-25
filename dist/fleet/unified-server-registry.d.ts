import type { McpServerConfig } from '../types.js';
export type FleetServerSource = 'ui' | 'wrapped' | 'ide';
export interface FleetServerEntry {
    name: string;
    transport: 'stdio' | 'sse' | 'streamable' | 'websocket';
    source: FleetServerSource;
    wrapped: boolean;
    config: McpServerConfig;
    configPath?: string;
    localUrl?: string;
    status?: 'running' | 'stopped' | 'unknown';
}
export interface DiscoverServersOptions {
    workspaceRoot?: string;
    includeIde?: boolean;
}
export declare function resolveWorkspaceRoot(explicit?: string): string;
export declare function configsDir(workspaceRoot?: string): string;
/**
 * Discover all MCP servers. Priority on name collision: UI > wrapped > IDE.
 */
export declare function discoverAllServers(opts?: DiscoverServersOptions): FleetServerEntry[];
export declare function isStdioUpstream(entry: FleetServerEntry): boolean;
export declare function isRemoteUpstream(entry: FleetServerEntry): boolean;
/** Write a single-server mcpServers JSON under mastyf-ai-configs/. */
export declare function materializeServerConfig(entry: FleetServerEntry, workspaceRoot?: string): string;
/** Merge remote-only servers into one manifest for a coordinator proxy child. */
export declare function materializeRemoteFleetManifest(entries: FleetServerEntry[], workspaceRoot?: string, portByName?: Map<string, number>): string | null;
export declare function fleetEntryFromMcpConfig(config: McpServerConfig, source?: FleetServerSource): FleetServerEntry;
//# sourceMappingURL=unified-server-registry.d.ts.map