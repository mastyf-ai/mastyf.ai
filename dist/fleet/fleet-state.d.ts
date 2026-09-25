export type FleetServerStatus = 'running' | 'stopped' | 'starting' | 'error';
export interface FleetServerState {
    name: string;
    pid: number;
    port: number;
    transport: 'stdio' | 'sse' | 'streamable' | 'remote-coordinator';
    status: FleetServerStatus;
    localUrl: string;
    configPath?: string;
}
export interface FleetState {
    servers: FleetServerState[];
    startedAt: string;
    adminPort: number;
    workspaceRoot: string;
    policyPath: string;
}
export declare const FLEET_STATE_PATH: string;
export declare const FLEET_PORT_MIN = 9100;
export declare const FLEET_PORT_MAX = 9198;
export declare const FLEET_ADMIN_PORT = 9199;
export declare function readFleetState(): FleetState | null;
export declare function writeFleetState(state: FleetState): void;
export declare function clearFleetState(): void;
/** Assign stable ports from pool, reusing prior assignments when possible. */
export declare function allocateFleetPorts(serverNames: string[], prior?: FleetState | null): Map<string, number>;
export declare function localIngressUrl(port: number, transport?: 'streamable' | 'sse'): string;
//# sourceMappingURL=fleet-state.d.ts.map