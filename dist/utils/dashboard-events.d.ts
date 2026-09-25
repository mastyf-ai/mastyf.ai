import type { WsBroadcaster, DashboardEvent } from '../dashboard/ws-broadcaster.js';
export type { FlowStep, FlowStepKind, FlowStepSeverity } from './flow-events.js';
export { emitFlowStep } from './flow-events.js';
export declare function setWsBroadcaster(instance: WsBroadcaster | null): void;
export declare function getWsBroadcaster(): WsBroadcaster | null;
export declare function broadcastDashboardEvent(event: DashboardEvent): void;
//# sourceMappingURL=dashboard-events.d.ts.map