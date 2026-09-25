/**
 * A2 — MCP Server Digital Twin capture and sandbox scorecard.
 */
import { createHash } from 'crypto';
function percentile(values, p) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx];
}
export class DigitalTwinCapture {
    store;
    observations = new Map();
    constructor(store) {
        this.store = store;
    }
    /** Load recent persisted observations on startup (cross-restart twin). */
    hydrateFromStore(serverName) {
        if (!this.store?.listDigitalTwinObservations)
            return;
        const rows = this.store.listDigitalTwinObservations(serverName);
        if (!rows.length)
            return;
        this.observations.set(serverName, rows.map(r => ({
            serverName: r.serverName,
            toolName: r.toolName,
            latencyMs: r.latencyMs,
            responseShape: r.responseShape,
            argsJson: r.argsJson,
        })));
    }
    record(obs) {
        const list = this.observations.get(obs.serverName) ?? [];
        list.push(obs);
        if (list.length > 500)
            list.splice(0, list.length - 500);
        this.observations.set(obs.serverName, list);
        this.store?.saveDigitalTwinObservation?.({
            serverName: obs.serverName,
            toolName: obs.toolName,
            argsJson: obs.argsJson,
            latencyMs: obs.latencyMs,
            responseShape: obs.responseShape,
        });
        if (list.length > 0 && list.length % 50 === 0) {
            this.snapshot(obs.serverName);
        }
    }
    snapshot(serverName) {
        const obs = this.observations.get(serverName) ?? [];
        if (!obs.length && this.store?.listDigitalTwinObservations) {
            this.hydrateFromStore(serverName);
        }
        const effective = this.observations.get(serverName) ?? [];
        if (!effective.length)
            return null;
        const latencies = effective.map(o => o.latencyMs);
        const shapes = effective.map(o => o.responseShape).join('|');
        const responseShapeHash = createHash('sha256').update(shapes).digest('hex').slice(0, 32);
        const tools = [...new Set(effective.map(o => o.toolName))];
        const snap = {
            id: createHash('sha256').update(`${serverName}:${Date.now()}`).digest('hex').slice(0, 16),
            serverName,
            schemaJson: { tools, sampleCount: effective.length },
            latencyP50Ms: percentile(latencies, 0.5),
            latencyP99Ms: percentile(latencies, 0.99),
            responseShapeHash,
            sampleCount: effective.length,
            capturedAt: new Date().toISOString(),
        };
        this.store?.saveDigitalTwinSnapshot?.(snap);
        return snap;
    }
    getBaselineP99(serverName) {
        const snap = this.snapshot(serverName);
        return snap?.latencyP99Ms ?? 0;
    }
    scoreSandbox(params) {
        const attacksBlockedPct = params.attacksTotal
            ? (params.attacksBlocked / params.attacksTotal) * 100
            : 100;
        const workflowsPreservedPct = params.workflowsTotal
            ? (params.workflowsPreserved / params.workflowsTotal) * 100
            : 100;
        const latencyDeltaP99Ms = params.sandboxP99Ms - params.baselineP99Ms;
        let goNoGo = 'go';
        let reason = 'Policy sandbox meets go criteria';
        if (attacksBlockedPct < 80) {
            goNoGo = 'no-go';
            reason = 'Blocks fewer than 80% of attack fixtures';
        }
        else if (workflowsPreservedPct < 95) {
            goNoGo = 'no-go';
            reason = 'Breaks more than 5% of legitimate workflows';
        }
        else if (latencyDeltaP99Ms > 500) {
            goNoGo = 'review';
            reason = 'p99 latency delta exceeds 500ms — review before apply';
        }
        if (params.capturedReplayed != null && params.capturedReplayed === 0) {
            goNoGo = goNoGo === 'go' ? 'review' : goNoGo;
            reason = 'No captured twin traffic replayed — run live capture before production apply';
        }
        else if (params.capturedPassRate != null && params.capturedPassRate < 90) {
            goNoGo = 'no-go';
            reason = `Captured traffic pass rate ${params.capturedPassRate.toFixed(0)}% below 90%`;
        }
        return {
            attacksBlockedPct,
            workflowsPreservedPct,
            latencyDeltaP99Ms,
            goNoGo,
            reason,
            attackBlockRate: attacksBlockedPct,
            workflowPreservation: workflowsPreservedPct,
            latencyDeltaPct: params.baselineP99Ms > 0
                ? (latencyDeltaP99Ms / params.baselineP99Ms) * 100
                : 0,
            summary: reason,
        };
    }
}
//# sourceMappingURL=twin-capture.js.map