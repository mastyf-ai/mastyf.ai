/**
 * Canonical agent-flow timeline steps for dashboard WebSocket push.
 */
import { randomUUID } from 'node:crypto';
import { broadcastDashboardEvent } from './dashboard-events.js';
export function emitFlowStep(step) {
    const id = step.id || randomUUID();
    const payload = {
        id,
        kind: step.kind,
        title: step.title,
        summary: step.summary,
        severity: step.severity,
        serverName: step.serverName,
        toolName: step.toolName,
        requestId: step.requestId,
        metadata: step.metadata,
    };
    broadcastDashboardEvent({
        type: 'flow:step',
        serverName: step.serverName,
        payload: { step: payload },
        timestamp: Date.now(),
    });
}
//# sourceMappingURL=flow-events.js.map