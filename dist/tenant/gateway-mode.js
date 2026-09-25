/**
 * Shared HTTP/SSE (and WebSocket) gateway mode — no stdio child processes.
 */
import { Logger } from '../utils/logger.js';
import { isMultiTenantModeEnabled } from './resolve-tenant.js';
export function isGatewayModeEnabled() {
    return (process.env['MASTYF_AI_GATEWAY_MODE'] === 'true'
        || process.argv.includes('--gateway'));
}
/** Fail fast when gateway mode is misconfigured. */
export function assertGatewayStartup() {
    if (!isMultiTenantModeEnabled()) {
        Logger.error('[gateway] MASTYF_AI_GATEWAY_MODE requires MASTYF_AI_MULTI_TENANT_ENABLED=true');
        throw new Error('Gateway mode requires multi-tenant enabled');
    }
    Logger.info('[gateway] Shared ingress mode — SSE/WebSocket only (no stdio MCP children)');
}
//# sourceMappingURL=gateway-mode.js.map