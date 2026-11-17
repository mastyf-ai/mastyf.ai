/**
 * Mastyf AI Security Middleware for OpenAI Agents SDK
 *
 * Secures OpenAI function/tool calls by routing them through the Mastyf AI
 * policy proxy before execution. Supports per-user identity context.
 *
 * Usage: wrap the tool definitions, then build the tools from them (the SDK runs a built
 * tool through its own `invoke`, so wrapping a built tool's `execute` has no effect):
 * ```ts
 * import { Agent, tool } from '@openai/agents';
 * import { wrapToolsWithMastyfGuard } from '@mastyf_ai/openai-agents-middleware';
 *
 * const definitions = wrapToolsWithMastyfGuard([readFileDefinition], {
 *   proxyUrl: 'http://localhost:4000',
 *   apiKey: process.env.MASTYF_AI_API_KEY,
 * });
 * const agent = new Agent({ name: 'assistant', tools: definitions.map((d) => tool(d)) });
 * ```
 *
 * `createMastyfGuardMiddleware` returns a `beforeToolCall` check to call yourself; the SDK
 * has no `middleware` option, so `new Agent({ middleware: [guard] })` does nothing.
 *
 * Fails closed: in the default `block` mode a tool call runs only when the proxy answers
 * `pass`. If the proxy is down, errors, times out or answers with something unexpected,
 * the call is blocked. Set `failOpen: true` to let calls through in that case instead.
 */

// Deprecated (printed once per process, when this module is first loaded).
process.emitWarning('@mastyf_ai/openai-agents-middleware is deprecated: use @mastyf_ai/guard/openai-agents, which checks tool calls on your own machine without a proxy.', { type: 'DeprecationWarning', code: 'MASTYF_DEP_OPENAI_AGENTS_MIDDLEWARE' });

export type MastyfGuardMode = 'audit' | 'warn' | 'block';

export interface MastyfGuardConfig {
  proxyUrl: string;
  apiKey?: string;
  tenantId?: string;
  /** block (default): deny what the policy denies. warn: log it and run anyway. audit: don't check. */
  mode?: MastyfGuardMode;
  /** Run tool calls when the proxy can't give an answer. Default false (block them). */
  failOpen?: boolean;
  timeoutMs?: number;
  blockedTools?: string[];
  identityContext?: {
    userId?: string;
    scopes?: string[];
    clientId?: string;
  };
}

export type MastyfGuardEvaluation = {
  allowed: boolean;
  reason: string;
  /** True when the proxy gave no usable answer (unreachable, HTTP error, bad response). */
  unavailable?: boolean;
};

function resolveMode(config: MastyfGuardConfig): MastyfGuardMode {
  return config.mode ?? 'block';
}

async function evaluateWithProxy(
  toolName: string,
  args: Record<string, unknown>,
  config: MastyfGuardConfig,
): Promise<MastyfGuardEvaluation> {
  const mode = resolveMode(config);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
  if (config.tenantId) headers['X-Tenant-Id'] = config.tenantId;
  if (config.identityContext?.userId) headers['X-User-Id'] = config.identityContext.userId;

  const unavailable = (reason: string): MastyfGuardEvaluation => ({
    allowed: config.failOpen === true,
    reason: `Mastyf proxy unavailable: ${reason}`,
    unavailable: true,
  });

  try {
    const res = await fetch(`${config.proxyUrl.replace(/\/$/, '')}/api/policy/test`, {
      method: 'POST',
      headers,
      // `arguments` / `mode` are what /api/policy/test reads; `args` / `blockingMode` were ignored.
      body: JSON.stringify({
        tool: toolName,
        server: config.identityContext?.clientId || 'openai-agent',
        arguments: args,
        mode,
      }),
      signal: AbortSignal.timeout(config.timeoutMs || 10_000),
    });

    if (!res.ok) return unavailable(`HTTP ${res.status}`);

    const data = (await res.json()) as { action?: unknown; reason?: unknown };
    if (data.action !== 'pass' && data.action !== 'flag' && data.action !== 'block') {
      return unavailable('unrecognised response');
    }
    return {
      // A flag is a deny in block mode and a warning otherwise.
      allowed: data.action === 'pass' || (data.action === 'flag' && mode !== 'block'),
      reason: typeof data.reason === 'string' ? data.reason : '',
    };
  } catch (err: any) {
    return unavailable(err?.message || String(err));
  }
}

/** One decision for both entry points: what the policy says, adjusted for the mode. */
async function decide(
  toolName: string,
  args: Record<string, unknown>,
  config: MastyfGuardConfig,
): Promise<{ allowed: boolean; reason?: string }> {
  const mode = resolveMode(config);
  if (mode === 'audit') return { allowed: true };

  const evaluation = await evaluateWithProxy(toolName, args, config);
  if (evaluation.allowed) return { allowed: true };

  if (mode === 'warn') {
    console.warn(`[Mastyf] ${toolName}: ${evaluation.reason}`);
    return { allowed: true };
  }
  return { allowed: false, reason: evaluation.reason || 'Blocked by Mastyf policy' };
}

export function createMastyfGuardMiddleware(config: MastyfGuardConfig) {
  const blockedSet = new Set(config.blockedTools || []);

  return {
    name: 'mastyf-guard',

    async beforeToolCall(input: { toolName: string; args: Record<string, unknown>; runContext?: any }): Promise<{ allowed: boolean; reason?: string }> {
      if (blockedSet.has(input.toolName)) {
        return { allowed: false, reason: `Tool "${input.toolName}" is blocked by Mastyf policy` };
      }
      return decide(input.toolName, input.args, config);
    },
  };
}

export function wrapToolsWithMastyfGuard(
  tools: Array<{ name: string; execute: Function }>,
  config: MastyfGuardConfig,
): Array<{ name: string; execute: Function }> {
  const blockedSet = new Set(config.blockedTools || []);

  return tools.map(tool => ({
    ...tool,
    name: tool.name,
    execute: async (args: Record<string, unknown>, ctx?: any) => {
      const decision = blockedSet.has(tool.name)
        ? { allowed: false, reason: `Tool "${tool.name}" is blocked by Mastyf policy` }
        : await decide(tool.name, args, config);

      if (!decision.allowed) {
        const err = new Error(`Mastyf blocked "${tool.name}": ${decision.reason}`);
        (err as any).mastyfBlocked = true;
        throw err;
      }

      return tool.execute(args, ctx);
    },
  }));
}
