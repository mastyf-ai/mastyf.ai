import type { IncomingMessage, ServerResponse } from 'http';
type WriteJson = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: IncomingMessage) => Promise<Record<string, unknown>>;
type SetCors = () => void;
type AssertFeature = (url: string, feature: 'swarm', res: ServerResponse, setCors: SetCors) => boolean;
export declare function handleDashboardThreatDiscoveryRoutes(params: {
    url: string;
    method: string;
    req: IncomingMessage;
    res: ServerResponse;
    requestTenantId: string;
    writeJson: WriteJson;
    readBody: ReadBody;
    setCors: SetCors;
    assertFeature: AssertFeature;
}): Promise<boolean>;
export {};
//# sourceMappingURL=dashboard-threat-discovery-routes.d.ts.map