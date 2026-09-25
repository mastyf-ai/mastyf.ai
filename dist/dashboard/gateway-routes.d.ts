/**
 * Mastyf Security Gateway API Routes for mastyf.ai
 *
 * Exposes /api/gateway/* endpoints on the dashboard server.
 * Security Invariants:
 * 1. Token Isolation: Reads ~/.mastyf/control_token on backend; never sends token to browser.
 * 2. Explicit Confirmation: Mutating actions (apply, rollback, activate) mandate { confirmation: true }
 *    in the payload. Only the backend sets X-Mastyf-Authorization: confirmed to Gateway.
 * 3. Authoritative Truth: Gateway errors yield structured GATEWAY_STATE_UNAVAILABLE errors.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { MastyfGatewayClient } from '../clients/gateway-client.js';
type WriteJson = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: IncomingMessage) => Promise<Record<string, unknown>>;
export declare function getGatewayClient(): MastyfGatewayClient;
export declare function setGatewayClient(client: MastyfGatewayClient | null): void;
export declare function handleGatewayApiRoutes(params: {
    url: string;
    method: string;
    req: IncomingMessage;
    res: ServerResponse;
    tenantId?: string;
    writeJson: WriteJson;
    readBody: ReadBody;
    setCors: () => void;
}): Promise<boolean>;
export {};
//# sourceMappingURL=gateway-routes.d.ts.map