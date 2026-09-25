export type ToolDefinitionSnapshot = {
    name: string;
    descriptionHash: string;
    schemaHash: string;
};
export type ServerToolBaseline = {
    serverName: string;
    fingerprint: string;
    tools: ToolDefinitionSnapshot[];
    toolNames: string[];
    capturedAt: string;
};
export type ToolIntegrityDiff = {
    kind: 'added' | 'removed' | 'modified' | 'typosquat';
    toolName: string;
    previous?: ToolDefinitionSnapshot;
    current?: ToolDefinitionSnapshot;
    severity: 'benign' | 'suspicious' | 'critical';
    reason: string;
};
export type ToolIntegrityReport = {
    serverName: string;
    changed: boolean;
    diffs: ToolIntegrityDiff[];
    previousFingerprint?: string;
    currentFingerprint: string;
    quarantineRecommended: boolean;
};
export declare function snapshotFromProbeTool(tool: {
    name: string;
    description?: string;
    inputSchema?: unknown;
}): ToolDefinitionSnapshot;
export declare function buildServerBaseline(serverName: string, tools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
}>): ServerToolBaseline;
export declare function diffToolBaselines(previous: ServerToolBaseline | null, current: ServerToolBaseline): ToolIntegrityReport;
export declare function summarizeToolIntegrityReports(reports: ToolIntegrityReport[]): {
    serversChecked: number;
    serversChanged: number;
    criticalCount: number;
    quarantineServers: string[];
};
//# sourceMappingURL=tool-integrity-watch.d.ts.map