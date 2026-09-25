/**
 * Metrics for policy hot-reload failures (M-012).
 */
import { Counter, Gauge } from 'prom-client';
export declare const policyLoadErrorsTotal: Counter<"reason">;
export declare const policyLoadErrorGauge: Gauge<"reason">;
export declare function recordPolicyLoadError(reason: string): void;
export declare function clearPolicyLoadError(): void;
/** @internal */
export declare function resetPolicyLoadMetricsForTests(): void;
//# sourceMappingURL=policy-load-metrics.d.ts.map