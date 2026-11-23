export interface InventoryServer {
    name: string;
    transport: 'stdio' | 'http';
    /** Already routed through a Mastyf proxy, so its calls are checked today. */
    protected: boolean;
}
export interface InventoryAgent {
    id: string;
    name: string;
    configPath: string;
    servers: InventoryServer[];
}
export interface AgentInventory {
    scannedAt: string;
    agents: InventoryAgent[];
    totals: {
        agents: number;
        servers: number;
        protectedServers: number;
    };
}
/** Same rule the Shield app uses to tell whether a server already runs behind Mastyf. */
export declare function isServerProtected(server: Record<string, unknown>): boolean;
export declare function scanAgentInventory(): AgentInventory;
//# sourceMappingURL=agent-inventory.d.ts.map