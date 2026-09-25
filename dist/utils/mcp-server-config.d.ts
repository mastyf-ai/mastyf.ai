import type { McpServerConfig } from '../types.js';
export type UiMcpServerConfig = {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    transport?: 'stdio' | 'sse';
    url?: string;
    disabled?: boolean;
};
export declare function listUiServers(): UiMcpServerConfig[];
export declare function uiServerToMcpConfig(ui: UiMcpServerConfig): McpServerConfig | null;
export declare function loadUiMcpServers(): McpServerConfig[];
/** UI-managed servers from ~/.mastyf-ai/servers.json override CLI entries by name. */
export declare function mergeCliAndUiServers(cliServers: McpServerConfig[]): McpServerConfig[];
export declare function addUiServer(config: UiMcpServerConfig): {
    ok: boolean;
    error?: string;
};
export declare function removeUiServer(name: string): {
    ok: boolean;
    error?: string;
};
export declare function updateUiServer(name: string, config: Partial<UiMcpServerConfig>): {
    ok: boolean;
    error?: string;
};
/** Generate a full mcpServers-compatible JSON object from UI configs */
export declare function buildMcpServersConfig(): Record<string, unknown>;
//# sourceMappingURL=mcp-server-config.d.ts.map