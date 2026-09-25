export declare function fleetRegion(): string;
export declare function fleetPeerRegions(): string[];
export declare function isFleetRedisSyncEnabled(): boolean;
export interface FleetRedisEvent {
    globalSessionId: string;
    agentId: string;
    serverName: string;
    toolName: string;
    eventType: string;
    blocked: boolean;
    timestamp: number;
    region?: string;
    edgeJson?: Record<string, unknown>;
}
export declare function publishFleetEventToRedis(evt: FleetRedisEvent): Promise<void>;
export declare function listFleetEventsFromRedis(globalSessionId: string): Promise<FleetRedisEvent[]>;
//# sourceMappingURL=fleet-chain-redis.d.ts.map