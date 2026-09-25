import type { CapabilityEdge } from '../capability-graph/graph-builder.js';
import { CapabilityGraphBuilder } from '../capability-graph/graph-builder.js';
export type StrideCategory = 'Spoofing' | 'Tampering' | 'Repudiation' | 'InformationDisclosure' | 'DenialOfService' | 'ElevationOfPrivilege';
export type LinddunCategory = 'Linkability' | 'Identifiability' | 'NonRepudiation' | 'Detectability' | 'Disclosure' | 'Unawareness' | 'NonCompliance';
export interface DfdNode {
    id: string;
    type: 'client' | 'proxy' | 'server' | 'tool' | 'datastore';
    label: string;
}
export interface DfdEdge {
    from: string;
    to: string;
    label: string;
}
export interface ToolThreatRow {
    toolName: string;
    serverName: string;
    stride: Partial<Record<StrideCategory, string>>;
    linddun: Partial<Record<LinddunCategory, string>>;
    mitigations: string[];
}
export interface ThreatModelReport {
    title: string;
    generatedAt: string;
    nodes: DfdNode[];
    edges: DfdEdge[];
    toolThreats: ToolThreatRow[];
    summary: string;
}
export declare function buildDfdFromConfig(servers: Array<{
    name: string;
    tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
    }>;
}>): {
    nodes: DfdNode[];
    edges: DfdEdge[];
};
export declare function buildToolThreats(servers: Array<{
    name: string;
    tools?: Array<{
        name: string;
        description?: string;
    }>;
}>, controlMitigations?: string[], capabilityEdges?: CapabilityEdge[]): ToolThreatRow[];
/** Map STRIDE categories to SOC2 control mitigations via ControlMapper heuristics. */
export declare function controlMapperMitigations(activePolicies?: string[]): string[];
export declare function generateThreatModelFromConfig(configPath: string, activePolicies?: string[], graphBuilder?: import('../capability-graph/graph-builder.js').CapabilityGraphBuilder): ThreatModelReport;
export declare function generateThreatModelFromEdges(serverName: string, edges: CapabilityEdge[], toolMeta?: Map<string, {
    description?: string;
}>): ThreatModelReport;
export declare function threatModelToMarkdown(report: ThreatModelReport): string;
export declare function generateThreatModelFromCapabilityGraph(serverName: string, graphBuilder: CapabilityGraphBuilder): ThreatModelReport;
export declare function loadMcpConfigServers(configPath: string): Array<{
    name: string;
    tools: Array<{
        name: string;
        description?: string;
    }>;
}>;
//# sourceMappingURL=stride-linddun.d.ts.map