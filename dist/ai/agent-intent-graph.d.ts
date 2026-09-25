/**
 * Agent Intent Graph — session-scoped kill-chain graph from flow history + chain patterns.
 */
import type { FlowEvent } from '../policy/session-flow-store.js';
import { type ChainGraphEdge, type ChainPatternMatch } from '../policy/session-chain-detector.js';
export type IntentGraphNodeRole = 'read' | 'transform' | 'exfil' | 'execute' | 'unknown';
export type IntentGraphNode = {
    index: number;
    toolName: string;
    role: IntentGraphNodeRole;
    at: number;
    sensitiveRead: boolean;
    encodeHint: boolean;
    exfilHint: boolean;
    citationId: string;
};
export type IntentGraphEdge = {
    from: number;
    to: number;
    kind: ChainGraphEdge['kind'];
};
export type AgentIntentGraph = {
    sessionKey: string;
    nodes: IntentGraphNode[];
    edges: IntentGraphEdge[];
    patterns: ChainPatternMatch[];
    inferredIntent: string;
    killChainStages: string[];
};
export declare function buildAgentIntentGraph(sessionKey: string, flow: FlowEvent[]): AgentIntentGraph;
export declare function buildKillChainNarrative(graph: AgentIntentGraph, anchorTool?: string, citations?: Array<{
    id: string;
    summary: string;
}>): string;
//# sourceMappingURL=agent-intent-graph.d.ts.map