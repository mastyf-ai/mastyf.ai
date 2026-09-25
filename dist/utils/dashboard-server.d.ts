import { createServer } from 'http';
import { PolicyWatcher } from '../policy/policy-watcher.js';
import { DashboardAuth } from '../auth/dashboard-auth.js';
import { WsBroadcaster } from '../dashboard/ws-broadcaster.js';
export { setAgenticContainer, getAgenticContainer, ensureAgenticContainer, isAgenticDemoMode, } from './agentic-container.js';
export declare function setDashboardDataSource(historyDb: any): void;
export declare function startDashboardServer(port?: number, policyWatcher?: PolicyWatcher, dashboardAuth?: DashboardAuth): Promise<{
    auth: DashboardAuth;
    server: ReturnType<typeof createServer>;
    ws: WsBroadcaster | null;
}>;
/** Stop WS push loop and close the dashboard HTTP server (proxy/TUI shutdown). */
export declare function closeDashboardServer(): Promise<void>;
//# sourceMappingURL=dashboard-server.d.ts.map