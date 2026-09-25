/**
 * Dashboard API routes for Industry-Standard Roadmap features (C5–B3).
 */
import type { IncomingMessage, ServerResponse } from 'http';
type WriteJson = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: IncomingMessage) => Promise<Record<string, unknown>>;
export declare function handleRoadmapApiRoutes(params: {
    url: string;
    method: string;
    req: IncomingMessage;
    res: ServerResponse;
    tenantId: string;
    writeJson: WriteJson;
    readBody: ReadBody;
    setCors: () => void;
}): Promise<boolean>;
export {};
//# sourceMappingURL=roadmap-routes.d.ts.map