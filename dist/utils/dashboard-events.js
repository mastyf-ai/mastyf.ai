export { emitFlowStep } from './flow-events.js';
let broadcaster = null;
export function setWsBroadcaster(instance) {
    broadcaster = instance;
}
export function getWsBroadcaster() {
    return broadcaster;
}
export function broadcastDashboardEvent(event) {
    broadcaster?.broadcast(event, event.tenantId);
}
//# sourceMappingURL=dashboard-events.js.map