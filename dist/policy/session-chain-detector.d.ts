import type { CallContext, PolicyDecision } from './policy-types.js';
import { type FlowEvent } from './session-flow-store.js';
export type ChainGraphNode = {
    toolName: string;
    at: number;
    argShapeHash?: string;
    sensitiveRead: boolean;
    encodeHint: boolean;
    exfilHint: boolean;
};
export type ChainGraphEdge = {
    from: number;
    to: number;
    kind: 'temporal' | 'similarity';
};
export type SessionChainGraph = {
    sessionKey: string;
    nodes: ChainGraphNode[];
    edges: ChainGraphEdge[];
};
export declare function buildSessionChainGraph(sessionKey: string, flow?: FlowEvent[]): SessionChainGraph;
export type ChainPatternMatch = {
    pattern: 'read-encode-exfil' | 'read-then-exfil' | 'encode-then-exfil' | 'multi-step-staging';
    nodes: number[];
    confidence: number;
};
export declare function detectChainPatterns(graph: SessionChainGraph): ChainPatternMatch[];
/** Evaluate cross-tool chain patterns against current session history (no recording). */
export declare function evaluateSessionChainGuard(ctx: CallContext): PolicyDecision | null;
export declare function recordSessionChainEvent(ctx: CallContext): void;
//# sourceMappingURL=session-chain-detector.d.ts.map