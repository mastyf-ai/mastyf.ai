/**
 * Monorepo bridge: wires root OAuthValidator + Defense Fabric into packages/server createHttpProxy.
 */
import { createHttpProxy, } from '@mastyf_ai/mcp-server/http-proxy';
import { OAuthValidator } from '../auth/oauth.js';
import { getMtlsAgent } from '../utils/mtls-agent-registry.js';
import { evaluateToolCallDefense } from './tool-call-defense-orchestrator.js';
function asHttpProxyAuthValidator(oauth) {
    return {
        getConfig: () => ({ required: oauth.getConfig().required }),
        validate: async (token) => {
            const result = await oauth.validate(token);
            return { valid: result.valid, error: result.error };
        },
        extractToken: (header) => OAuthValidator.extractToken(header),
    };
}
export function buildDefenseHookFromPolicyEngine(policyEngine, opts) {
    return {
        async evaluate(req) {
            const outcome = await evaluateToolCallDefense({
                serverName: req.serverName,
                toolName: req.toolName,
                arguments: req.arguments,
                requestId: req.requestId,
                requestTokens: req.requestTokens,
                tenantId: req.tenantId ?? 'default',
                timestamp: req.timestamp,
            }, {
                policyEngine,
                db: opts?.db,
                rugPullState: opts?.rugPullState,
            });
            if (!outcome.allowed) {
                return {
                    allowed: false,
                    code: outcome.code,
                    rule: outcome.rule,
                    reason: outcome.reason,
                    httpStatus: outcome.httpStatus,
                };
            }
            return {
                allowed: true,
                arguments: outcome.arguments,
                spendReservationId: outcome.spendReservationId,
            };
        },
    };
}
export function buildAuthConfigFromEnv() {
    const issuer = process.env['MASTYF_AI_AUTH_ISSUER'];
    const audience = process.env['MASTYF_AI_AUTH_AUDIENCE'];
    if (!issuer || !audience)
        return null;
    return {
        issuer,
        audience,
        required: process.env['MASTYF_AI_AUTH_REQUIRED'] === 'true',
    };
}
export function createHttpProxyWithOAuth(targetUrl, policyEngine, db, tokenCounter, options = {}) {
    const authConfig = options.authConfig ?? buildAuthConfigFromEnv();
    const authValidator = authConfig
        ? asHttpProxyAuthValidator(new OAuthValidator(authConfig))
        : options.authValidator ?? null;
    const defenseHook = policyEngine
        ? buildDefenseHookFromPolicyEngine(policyEngine, {
            serverName: options.serverName ?? targetUrl,
            db: options.db,
            rugPullState: options.rugPullState,
        })
        : null;
    return createHttpProxy(targetUrl, policyEngine, db, tokenCounter, {
        ...options,
        authValidator: authValidator ?? undefined,
        upstreamAgent: 'upstreamAgent' in options ? options.upstreamAgent : getMtlsAgent(),
        defenseHook,
        serverName: options.serverName ?? targetUrl,
        tenantId: options.tenantId ?? process.env['MASTYF_AI_TENANT_ID'] ?? 'default',
    });
}
export { OAuthValidator };
//# sourceMappingURL=create-http-proxy-bridge.js.map