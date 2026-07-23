/**
 * Monorepo bridge: wires root OAuthValidator + Defense Fabric into packages/server createHttpProxy.
 */
import {
  createHttpProxy,
  type CreateHttpProxyOptions,
  type HttpProxyAuthValidator,
} from '@mastyf_ai/mcp-server/http-proxy';
import type {
  ToolCallDefenseHook,
  ToolCallDefenseHookResult,
  ToolCallDefenseRequest,
} from '@mastyf_ai/mcp-server/tool-call-defense-hook';
import { OAuthValidator } from '../auth/oauth.js';
import type { AuthConfig } from '../auth/auth-types.js';
import { getMtlsAgent } from '../utils/mtls-agent-registry.js';
import type { PolicyEngine } from '../policy/policy-engine.js';
import type { IDatabase } from '../database/database-interface.js';
import type { ToolFingerprintState } from './tool-fingerprint.js';
import { evaluateToolCallDefense } from './tool-call-defense-orchestrator.js';
import type http from 'http';
import type https from 'https';

export type { ToolCallDefenseHook, ToolCallDefenseRequest, ToolCallDefenseHookResult };

interface TokenCounterLike { count(text: string): number; }
interface DatabaseLike { addCallRecord(r: any): Promise<void>; }

function asHttpProxyAuthValidator(oauth: OAuthValidator): HttpProxyAuthValidator {
  return {
    getConfig: () => ({ required: oauth.getConfig().required }),
    validate: async (token) => {
      const result = await oauth.validate(token);
      return { valid: result.valid, error: result.error };
    },
    extractToken: (header) => OAuthValidator.extractToken(header),
  };
}

export function buildDefenseHookFromPolicyEngine(
  policyEngine: PolicyEngine,
  opts?: {
    serverName?: string;
    db?: IDatabase;
    rugPullState?: ToolFingerprintState;
  },
): ToolCallDefenseHook {
  return {
    async evaluate(req: ToolCallDefenseRequest): Promise<ToolCallDefenseHookResult> {
      const outcome = await evaluateToolCallDefense(
        {
          serverName: req.serverName,
          toolName: req.toolName,
          arguments: req.arguments,
          requestId: req.requestId,
          requestTokens: req.requestTokens,
          tenantId: req.tenantId ?? 'default',
          timestamp: req.timestamp,
        },
        {
          policyEngine,
          db: opts?.db,
          rugPullState: opts?.rugPullState,
        },
      );
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

export function buildAuthConfigFromEnv(): AuthConfig | null {
  const issuer = process.env['MASTYF_AI_AUTH_ISSUER'];
  const audience = process.env['MASTYF_AI_AUTH_AUDIENCE'];
  if (!issuer || !audience) return null;
  return {
    issuer,
    audience,
    required: process.env['MASTYF_AI_AUTH_REQUIRED'] === 'true',
  };
}

export interface CreateDefenseHttpProxyOptions extends CreateHttpProxyOptions {
  authConfig?: AuthConfig | null;
  policyEngine?: PolicyEngine | null;
  db?: IDatabase;
  rugPullState?: ToolFingerprintState;
}

export function createHttpProxyWithOAuth(
  targetUrl: string,
  policyEngine: PolicyEngine | null,
  db: DatabaseLike,
  tokenCounter: TokenCounterLike,
  options: CreateDefenseHttpProxyOptions = {},
): http.Server | https.Server {
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
