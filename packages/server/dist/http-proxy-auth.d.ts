import type { IncomingMessage, ServerResponse } from 'http';
export interface HttpProxyAuthValidator {
    getConfig(): {
        required: boolean;
    };
    validate(token: string): Promise<{
        valid: boolean;
        error?: string;
    }>;
    extractToken?(authHeader: string | undefined): string | null;
}
export type AuthGateResult = {
    ok: true;
} | {
    ok: false;
    status: 401 | 403;
    message: string;
};
export declare function runHttpProxyAuthGate(req: IncomingMessage, validator: HttpProxyAuthValidator): Promise<AuthGateResult>;
export declare function sendAuthGateFailure(res: ServerResponse, failure: Extract<AuthGateResult, {
    ok: false;
}>): void;
