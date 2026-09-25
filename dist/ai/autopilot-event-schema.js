function mkEventId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function makeThreatEvent(tenantId, payload) {
    return {
        schemaVersion: '2026-05-1',
        kind: 'threat',
        eventId: mkEventId('thr'),
        tenantId,
        timestamp: new Date().toISOString(),
        payload,
    };
}
export function makeDecisionEvent(tenantId, payload) {
    return {
        schemaVersion: '2026-05-1',
        kind: 'decision',
        eventId: mkEventId('dec'),
        tenantId,
        timestamp: new Date().toISOString(),
        payload,
    };
}
export function makeRolloutEvent(tenantId, payload) {
    return {
        schemaVersion: '2026-05-1',
        kind: 'rollout',
        eventId: mkEventId('rol'),
        tenantId,
        timestamp: new Date().toISOString(),
        payload,
    };
}
//# sourceMappingURL=autopilot-event-schema.js.map