/**
 * MCP Supply Chain Graph — server → tool → sensitive arg paths + blast radius.
 */
import type { ServerToolBaseline } from './tool-integrity-watch.js';
import { type ToolIntegrityReport } from './tool-integrity-watch.js';
export type SupplyChainNodeKind = 'server' | 'tool' | 'arg_path' | 'agent';
export type SupplyChainNode = {
    id: string;
    kind: SupplyChainNodeKind;
    label: string;
    severity?: 'benign' | 'suspicious' | 'critical';
    metadata?: Record<string, string | number | boolean>;
};
export type SupplyChainEdge = {
    from: string;
    to: string;
    kind: 'hosts' | 'exposes' | 'calls' | 'drift';
};
export type SupplyChainGraph = {
    nodes: SupplyChainNode[];
    edges: SupplyChainEdge[];
    blastRadius: Array<{
        toolId: string;
        downstreamAgents: number;
        risk: string;
    }>;
    generatedAt: string;
};
export declare function buildSupplyChainGraph(baselines: ServerToolBaseline[], agentCallCounts?: Record<string, number>, integrityReports?: ToolIntegrityReport[]): SupplyChainGraph;
export declare function buildSupplyChainFromIntegrityDiff(previous: ServerToolBaseline | null, current: ServerToolBaseline): SupplyChainGraph;
//# sourceMappingURL=supply-chain-graph.d.ts.map