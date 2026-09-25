export declare function isTracingEnabled(): boolean;
/** Resolved OTLP HTTP traces URL (`…/v1/traces`). */
export declare function resolveOtlpTracesEndpoint(): string | null;
export declare function isTracingInitialized(): boolean;
/** Hex trace_id / span_id for structured log correlation. */
export declare function getTraceLogFields(): {
    trace_id?: string;
    span_id?: string;
};
/**
 * OpenTelemetry tracing for distributed request tracking across proxy → upstream.
 * Enable with: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 */
export declare function initTracing(): Promise<void>;
export declare function shutdownTracing(): Promise<void>;
export declare function injectTraceHeaders(headers: Record<string, string>): Record<string, string>;
/** @deprecated Prefer runWithExtractedTrace from proxy/trace-context.js */
export declare function extractTraceContext(headers: Record<string, string | string[] | undefined>): void;
export declare function withToolCallSpan<T>(name: string, attrs: Record<string, string | number>, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=tracing.d.ts.map