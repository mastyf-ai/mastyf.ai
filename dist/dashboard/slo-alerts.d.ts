/**
 * In-app SLO alert evaluation — never invents firing from missing samples.
 */
export type SloAlertState = 'ok' | 'firing' | 'UNAVAILABLE';
export type SloAlertSnapshot = {
    decide_p95: SloAlertState;
    escalation_backlog: SloAlertState;
    chain_integrity: SloAlertState;
    self_test_stale: SloAlertState;
};
export declare function evaluateSloAlerts(input: {
    p95Ms?: number | null;
    latencySamples?: number | null;
    thresholdMs?: number | null;
    escalated?: number | null;
    chainOk?: boolean | null;
    selfTestUnixSec?: number | null;
    nowUnixSec?: number;
}): SloAlertSnapshot;
//# sourceMappingURL=slo-alerts.d.ts.map