import { type FleetServerEntry } from './unified-server-registry.js';
import { type FleetState } from './fleet-state.js';
import { type WrapClient } from '../wrap/client-wrap.js';
export interface FleetSupervisorOptions {
    workspaceRoot?: string;
    installRoot?: string;
    policyPath?: string;
    blockingMode?: string;
    client?: WrapClient;
    applyIde?: boolean;
    includeIde?: boolean;
}
export declare class FleetSupervisor {
    private opts;
    private children;
    private adminServer;
    private installRoot;
    private workspaceRoot;
    private policyPath;
    private blockingMode;
    private client;
    private applyIde;
    constructor(opts?: FleetSupervisorOptions);
    start(): Promise<FleetState>;
    stop(): Promise<void>;
    addServer(entry: FleetServerEntry): Promise<{
        localUrl: string;
        reloadRequired: boolean;
    }>;
    removeServer(name: string): Promise<void>;
    private restartRemoteCoordinator;
    private updateFleetStateEntry;
    private spawnProxyChild;
    private startAdminServer;
    private handleAdmin;
}
export declare function getActiveSupervisor(): FleetSupervisor | null;
export declare function runFleetSupervisor(opts?: FleetSupervisorOptions): Promise<never>;
export declare function fleetAdminRequest(path: string, method?: 'GET' | 'POST'): Promise<unknown>;
//# sourceMappingURL=fleet-supervisor.d.ts.map