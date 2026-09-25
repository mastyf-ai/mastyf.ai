/**
 * Optional OpenTelemetry emission for Mastyf security OS attributes (OS5).
 * Real attribute emission path when OTEL exporter / MASTYF_OTEL_ENABLED is set.
 * No-op only when exporter unset — never invents metrics or Trust scores.
 *
 * Attributes (mastyf.*), aligned with OpenTelemetry MCP/GenAI semconv spirit:
 *   decision | cbac | difc | workflow | guard | arbiter |
 *   execution | bytes_sent | receipt_id | policy_hash
 */
export declare const MASTYF_OTEL_ATTR_KEYS: readonly ["mastyf.decision", "mastyf.cbac", "mastyf.difc", "mastyf.workflow", "mastyf.guard", "mastyf.arbiter", "mastyf.execution", "mastyf.bytes_sent", "mastyf.receipt_id", "mastyf.policy_hash"];
export type MastyfOtelAttrKey = (typeof MASTYF_OTEL_ATTR_KEYS)[number];
export type MastyfOtelAttrs = Partial<{
    'mastyf.decision': string;
    'mastyf.cbac': string;
    'mastyf.difc': string;
    'mastyf.workflow': string;
    'mastyf.guard': string;
    'mastyf.arbiter': string;
    'mastyf.execution': string;
    'mastyf.bytes_sent': number;
    'mastyf.receipt_id': string;
    'mastyf.policy_hash': string;
}>;
export declare function isOtelExporterConfigured(): boolean;
/** Flatten mastyf.* keys with defined values (required OS5 keys first). */
export declare function flattenMastyfOtelAttrs(attrs: MastyfOtelAttrs & Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean>;
/**
 * Emit a `mastyf.decision` span with security attributes.
 * No-op when exporter unset or tracer unavailable.
 */
export declare function emitMastyfDecision(attrs: MastyfOtelAttrs & Record<string, string | number | boolean | undefined>): void;
/** Build attrs from a gateway /v1/decide-shaped payload (best-effort). */
export declare function mastyfAttrsFromDecide(input: {
    finalDecision?: string;
    cbacDecision?: string;
    difcDecision?: string;
    workflowDecision?: string;
    aiaDecision?: string;
    arbiterDecision?: string;
    execution?: string;
    bytesSent?: number;
    receiptId?: string;
    policyHash?: string;
    raw?: Record<string, unknown>;
}): MastyfOtelAttrs;
export declare function startDashboardTelemetry(): Promise<void>;
export declare function stopDashboardTelemetry(): Promise<void>;
//# sourceMappingURL=dashboard-telemetry.d.ts.map