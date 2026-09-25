/**
 * In-app SLO alert evaluation — never invents firing from missing samples.
 */
export function evaluateSloAlerts(input) {
    const now = input.nowUnixSec ?? Math.floor(Date.now() / 1000);
    const threshold = input.thresholdMs ?? 800;
    const samples = input.latencySamples ?? 0;
    let decide = 'UNAVAILABLE';
    if (samples >= 5 && typeof input.p95Ms === 'number' && Number.isFinite(input.p95Ms)) {
        decide = input.p95Ms > threshold ? 'firing' : 'ok';
    }
    let esc = 'UNAVAILABLE';
    if (typeof input.escalated === 'number') {
        esc = input.escalated > 0 ? 'firing' : 'ok';
    }
    let chain = 'UNAVAILABLE';
    if (input.chainOk === true)
        chain = 'ok';
    else if (input.chainOk === false)
        chain = 'firing';
    let selfTest = 'UNAVAILABLE';
    if (typeof input.selfTestUnixSec === 'number' && Number.isFinite(input.selfTestUnixSec)) {
        selfTest = now - input.selfTestUnixSec > 86400 ? 'firing' : 'ok';
    }
    return {
        decide_p95: decide,
        escalation_backlog: esc,
        chain_integrity: chain,
        self_test_stale: selfTest,
    };
}
//# sourceMappingURL=slo-alerts.js.map