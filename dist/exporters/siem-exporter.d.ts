export interface SiemEvent {
    /** Event timestamp (ISO 8601). */
    timestamp: string;
    /** Policy decision action: block, flag, pass. */
    action: string;
    /** Policy rule that triggered. */
    rule: string;
    /** Reason for the decision. */
    reason: string;
    /** MCP server name. */
    serverName: string;
    /** Tool name. */
    toolName: string;
    /** Tenant identifier. */
    tenantId: string;
    /** Request ID. */
    requestId: string;
    /** Anomaly score (0–1) if available. */
    anomalyScore?: number;
    /** Threat intel reference if applicable. */
    threatIntelRef?: string;
    /** Source IP or client identifier. */
    clientIp?: string;
    /** Agent identity. */
    agentIdentity?: string;
    /** Additional context. */
    extra?: Record<string, unknown>;
}
export interface SiemConfig {
    enabled: boolean;
    protocol: 'cef' | 'syslog' | 'splunk-hec';
    endpoint: string;
    token?: string;
    facility: string;
    batchSize: number;
    flushIntervalMs: number;
    severityMap: Record<string, string>;
}
export declare function enqueueSiemEvent(event: SiemEvent): void;
/** Export a single policy decision event to SIEM. */
export declare function exportPolicyDecision(event: SiemEvent): void;
/** Graceful shutdown — flush pending events. */
export declare function shutdownSiemExporter(): Promise<void>;
/** Test helper — reset queue and timer. */
export declare function resetSiemExporterForTests(): void;
//# sourceMappingURL=siem-exporter.d.ts.map