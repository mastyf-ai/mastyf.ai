import type { IncomingMessage, ServerResponse } from 'http';
import type { PolicyWatcher } from '../policy/policy-watcher.js';
type WriteJson = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: IncomingMessage) => Promise<Record<string, unknown>>;
type SetCors = () => void;
type AssertFeature = (url: string, feature: 'swarm', res: ServerResponse, setCors: SetCors) => boolean;
export declare function handleDashboardSecuritySwarmRoutes(params: {
    url: string;
    method: string;
    req: IncomingMessage;
    res: ServerResponse;
    requestTenantId: string;
    policyWatcher?: PolicyWatcher | null;
    writeJson: WriteJson;
    readBody: ReadBody;
    setCors: SetCors;
    assertFeature: AssertFeature;
}): Promise<boolean>;
export {};
//# sourceMappingURL=dashboard-security-swarm-routes.d.ts.map