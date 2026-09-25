import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import { buildIrSiemBundle } from './siem-export.js';
export interface FleetChainEvent {
    globalSessionId: string;
    agentId: string;
    serverName: string;
    toolName: string;
    eventType: string;
    mitreTechnique?: string;
    blocked: boolean;
    timestamp: number;
    argumentsSnapshot?: Record<string, unknown>;
}
export interface FleetChainAlert {
    alertId: string;
    globalSessionId: string;
    agents: string[];
    servers: string[];
    tools: string[];
    pattern: string;
    mitreTechniques: string[];
    confidence: number;
    description: string;
    collusionCorrelated?: boolean;
}
export declare class FleetChainDetector {
    private readonly store?;
    private events;
    private alerts;
    constructor(store?: IndustryStandardStore | undefined);
    record(params: {
        globalSessionId: string;
        agentId: string;
        serverName: string;
        toolName: string;
        eventType?: string;
        blocked?: boolean;
        arguments?: Record<string, unknown>;
    }): FleetChainAlert | null;
    private mergeRedisEvents;
    /** Merge persisted fleet events (multi-replica / restart safe) with in-memory buffer. */
    private hydrateSessionEvents;
    private detectCrossServerChain;
    private triggerIncidentPlaybook;
    private emitSiemAlert;
    private toSessionGraph;
    getAlerts(limit?: number): FleetChainAlert[];
    exportIrBundle(sessionId: string): Record<string, unknown>;
    exportSiemBundle(sessionId?: string): ReturnType<typeof buildIrSiemBundle>;
    /** Graph nodes/edges for dashboard visualization (A1). */
    exportChainGraph(sessionId?: string): {
        nodes: Array<{
            id: string;
            label: string;
            type: 'agent' | 'server' | 'tool';
        }>;
        edges: Array<{
            from: string;
            to: string;
            label: string;
            blocked?: boolean;
        }>;
        alerts: FleetChainAlert[];
    };
}
//# sourceMappingURL=fleet-chain-detector.d.ts.map