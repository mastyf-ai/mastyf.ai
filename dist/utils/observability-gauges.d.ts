/** Updated by semantic LLM health probes and incident-responder trackLlmHealth. */
export declare function setLlmProbeOnline(online: boolean): void;
export declare function probeRedisAvailable(): Promise<boolean>;
/** Refresh Prometheus gauges referenced by enterprise PrometheusRule alerts. */
export declare function refreshObservabilityGauges(): Promise<void>;
//# sourceMappingURL=observability-gauges.d.ts.map