import type { IncomingMessage, ServerResponse } from 'http';
type SetCorsFn = () => void;
export declare function handleNewApiRoutes(url: string, method: string | undefined, req: IncomingMessage, res: ServerResponse, setCors: SetCorsFn, deps: {
    policyEngine?: {
        evaluateAsync: (ctx: unknown) => Promise<{
            action: string;
            rule: string;
            reason: string;
        }>;
    };
    tenantId?: string;
    db?: any;
}): Promise<boolean>;
export {};
//# sourceMappingURL=dashboard-new-api-routes.d.ts.map