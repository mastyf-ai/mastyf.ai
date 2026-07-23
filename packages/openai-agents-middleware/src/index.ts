/**
 * Mastyf AI Security Middleware for OpenAI Agents SDK
 *
 * Secures OpenAI function/tool calls by routing them through the Mastyf AI
 * policy proxy before execution. Supports per-user identity context.
 *
 * Usage:
 * ```ts
 * import { createMastyfGuardMiddleware } from '@mastyf_ai/openai-agents-middleware';
 *
 * const guard = createMastyfGuardMiddleware({
 *   proxyUrl: 'http://localhost:4000',
 *   apiKey: process.env.MASTYF_AI_API_KEY,
 * });
 *
 * const agent = new Agent({
 *   name: 'assistant',
 *   tools: [searchTool, fileReadTool],
 *   middleware: [guard],
 * });
 * ```
 */

export interface MastyfGuardConfig {
  proxyUrl: string;
  apiKey?: string;
  tenantId?: string;
  mode?: 'audit' | 'warn' | 'block';
  timeoutMs?: number;
  blockedTools?: string[];
  identityContext?: {
    userId?: string;
    scopes?: string[];
    clientId?: string;
  };
}

async function evaluateWithProxy(
  toolName: string,
  args: Record<string, unknown>,
  config: MastyfGuardConfig,
): Promise<{ allowed: boolean; reason: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
  if (config.tenantId) headers['X-Tenant-Id'] = config.tenantId;
  if (config.identityContext?.userId) headers['X-User-Id'] = config.identityContext.userId;

  try {
    const res = await fetch(`${config.proxyUrl.replace(/\/$/, '')}/api/policy/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tool: toolName,
        server: config.identityContext?.clientId || 'openai-agent',
        args,
        blockingMode: config.mode,
      }),
      signal: AbortSignal.timeout(config.timeoutMs || 10_000),
    });

    if (!res.ok) {
      return { allowed: config.mode !== 'block', reason: `Proxy HTTP ${res.status}` };
    }

    const data = await res.json();
    return {
      allowed: data.action === 'pass' || (data.action === 'flag' && config.mode !== 'block'),
      reason: data.reason || '',
    };
  } catch (err: any) {
    return { allowed: config.mode !== 'block', reason: err.message };
  }
}

export function createMastyfGuardMiddleware(config: MastyfGuardConfig) {
  const blockedSet = new Set(config.blockedTools || []);

  return {
    name: 'mastyf-guard',

    async beforeToolCall(input: { toolName: string; args: Record<string, unknown>; runContext?: any }): Promise<{ allowed: boolean; reason?: string }> {
      if (blockedSet.has(input.toolName)) {
        return { allowed: false, reason: `Tool "${input.toolName}" is blocked by Mastyf policy` };
      }

      if (config.mode === 'audit') return { allowed: true };

      const evaluation = await evaluateWithProxy(input.toolName, input.args, config);

      if (!evaluation.allowed && config.mode === 'block') {
        return { allowed: false, reason: evaluation.reason };
      }

      if (!evaluation.allowed && config.mode === 'warn') {
        console.warn(`[Mastyf] ${input.toolName}: ${evaluation.reason}`);
      }

      return { allowed: true };
    },
  };
}

export function wrapToolsWithMastyfGuard(
  tools: Array<{ name: string; execute: Function }>,
  config: MastyfGuardConfig,
): Array<{ name: string; execute: Function }> {
  return tools.map(tool => ({
    ...tool,
    name: tool.name,
    execute: async (args: Record<string, unknown>, ctx?: any) => {
      const evaluation = await evaluateWithProxy(tool.name, args, config);

      if (!evaluation.allowed) {
        const err = new Error(`Mastyf blocked "${tool.name}": ${evaluation.reason}`);
        (err as any).mastyfBlocked = true;
        throw err;
      }

      return tool.execute(args, ctx);
    },
  }));
}
