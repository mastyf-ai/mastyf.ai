/**
 * Capability graph builder — edges from tools/list + observed tool calls.
 */
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface CapabilityEdge {
    serverName: string;
    sourceTool: string;
    targetResource?: string;
    edgeType: 'declared' | 'observed' | 'resource';
    metadata?: Record<string, unknown>;
}
export interface ToolListEntry {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}
export declare class CapabilityGraphBuilder {
    private readonly store?;
    private edges;
    constructor(store?: IndustryStandardStore | undefined);
    buildFromToolList(serverName: string, tools: ToolListEntry[]): CapabilityEdge[];
    recordObservedCall(serverName: string, fromTool: string, toTool: string, metadata?: Record<string, unknown>): CapabilityEdge;
    getEdges(serverName: string): CapabilityEdge[];
    private persist;
    /** Emit DFD nodes/edges from tools/list registry + capability edges (C2). */
    buildDfdFromRegistry(servers: Array<{
        name: string;
        tools?: ToolListEntry[];
    }>): {
        nodes: Array<{
            id: string;
            type: 'client' | 'proxy' | 'server' | 'tool' | 'datastore';
            label: string;
        }>;
        edges: Array<{
            from: string;
            to: string;
            label: string;
        }>;
    };
}
//# sourceMappingURL=graph-builder.d.ts.map