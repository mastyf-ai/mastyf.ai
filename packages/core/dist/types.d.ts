export type Severity = "critical" | "warning" | "info";
export type DetectionLayer = "regex" | "schema" | "semantic" | "argument";
export interface Issue {
    id: string;
    layer: DetectionLayer;
    severity: Severity;
    category: string;
    message: string;
    evidence: string;
    confidence: number;
}
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema?: {
        type: string;
        properties?: Record<string, {
            type: string;
            description?: string;
            default?: unknown;
            enum?: unknown[];
        }>;
        required?: string[];
    };
}
export type ScanStatus = "clean" | "warning" | "critical";
export interface ToolScanResult {
    toolName: string;
    status: ScanStatus;
    issues: Issue[];
    layers: {
        regex: {
            ran: boolean;
            durationMs: number;
        };
        schema: {
            ran: boolean;
            durationMs: number;
        };
        semantic: {
            ran: boolean;
            durationMs: number;
            skipped?: string;
        };
    };
}
export interface ServerScanResult {
    serverName: string;
    transport: "stdio" | "http" | "sse";
    scannedAt: string;
    status: ScanStatus;
    tools: ToolScanResult[];
    summary: {
        total: number;
        clean: number;
        warnings: number;
        critical: number;
    };
    /** Present when scan stopped early due to server budget or tool cap. */
    truncated?: {
        reason: string;
        budgetMs: number;
        scanned: number;
        total: number;
    };
}
export interface ToolManifestEntry {
    toolName: string;
    serverName: string;
    hash: string;
    hmac: string;
    approvedAt: string;
    version: number;
}
export type ManifestVerifyStatus = "created" | "verified" | "changed" | "tampered" | "error";
export interface ManifestVerifyResult {
    status: ManifestVerifyStatus;
    changedTools: string[];
    newTools: string[];
    removedTools: string[];
    tamperedEntries: string[];
    /** Present when status is "error" (e.g. missing manifest secret in strict mode). */
    error?: string;
}
//# sourceMappingURL=types.d.ts.map