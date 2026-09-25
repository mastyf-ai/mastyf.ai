/**
 * Agent stack graph — MCP servers, tools, upstream APIs, npm packages.
 */
import type { McpServerConfig } from '../types.js';
import type { AgentStackGraph, AgentStackGraphSlice } from './types.js';
export declare function buildAgentStackGraph(servers: McpServerConfig[], opts?: {
    toolsByServer?: Record<string, string[]>;
    observedUrls?: string[];
}): AgentStackGraph;
/** Slice graph around a server or package name. */
export declare function sliceGraphAround(graph: AgentStackGraph, name: string): AgentStackGraphSlice;
//# sourceMappingURL=stack-graph.d.ts.map