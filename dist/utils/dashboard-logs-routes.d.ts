import { IncomingMessage, ServerResponse } from 'http';
interface RouteParams {
    url: string;
    method: string;
    req: IncomingMessage;
    res: ServerResponse;
    requestTenantId: string;
    writeJson: (res: ServerResponse, status: number, body: unknown) => void;
    readBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
    setCors: () => void;
    runtimeHistoryDb?: any;
}
export declare function handleDashboardLogsRoutes(params: RouteParams): Promise<boolean>;
export {};
//# sourceMappingURL=dashboard-logs-routes.d.ts.map