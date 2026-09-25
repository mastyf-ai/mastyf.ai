/**
 * Monorepo bridge: wires root OAuthValidator + Defense Fabric into packages/server createHttpProxy.
 */
import { type CreateHttpProxyOptions } from '@mastyf_ai/mcp-server/http-proxy';
import type { ToolCallDefenseHook, ToolCallDefenseHookResult, ToolCallDefenseRequest } from '@mastyf_ai/mcp-server/tool-call-defense-hook';
import { OAuthValidator } from '../auth/oauth.js';
import type { AuthConfig } from '../auth/auth-types.js';
import type { PolicyEngine } from '../policy/policy-engine.js';
import type { IDatabase } from '../database/database-interface.js';
import type { ToolFingerprintState } from './tool-fingerprint.js';
import type http from 'http';
import type https from 'https';
export type { ToolCallDefenseHook, ToolCallDefenseRequest, ToolCallDefenseHookResult };
interface TokenCounterLike {
    count(text: string): number;
}
interface DatabaseLike {
    addCallRecord(r: any): Promise<void>;
}
export declare function buildDefenseHookFromPolicyEngine(policyEngine: PolicyEngine, opts?: {
    serverName?: string;
    db?: IDatabase;
    rugPullState?: ToolFingerprintState;
}): ToolCallDefenseHook;
export declare function buildAuthConfigFromEnv(): AuthConfig | null;
export interface CreateDefenseHttpProxyOptions extends CreateHttpProxyOptions {
    authConfig?: AuthConfig | null;
    policyEngine?: PolicyEngine | null;
    db?: IDatabase;
    rugPullState?: ToolFingerprintState;
}
export declare function createHttpProxyWithOAuth(targetUrl: string, policyEngine: PolicyEngine | null, db: DatabaseLike, tokenCounter: TokenCounterLike, options?: CreateDefenseHttpProxyOptions): http.Server | https.Server;
export { OAuthValidator };
//# sourceMappingURL=create-http-proxy-bridge.d.ts.map