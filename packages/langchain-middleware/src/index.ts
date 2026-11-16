/**
 * Mastyf AI Security Middleware for LangChain
 *
 * Wraps LangChain tools with the Mastyf AI policy proxy, intercepting every
 * tool call for security evaluation before it reaches the actual tool
 * implementation. Supports audit, warn, and block modes.
 *
 * Usage:
 * ```ts
 * import { createMastyfToolWrapper } from '@mastyf_ai/langchain-middleware';
 *
 * const secureTools = tools.map(tool =>
 *   createMastyfToolWrapper(tool, {
 *     proxyUrl: 'http://localhost:4000',
 *     apiKey: process.env.MASTYF_AI_API_KEY,
 *     mode: 'block',
 *   })
 * );
 * ```
 *
 * Fails closed: in the default `block` mode a tool call runs only when the proxy answers
 * `pass`. If the proxy is down, errors, times out or answers with something unexpected,
 * the call is blocked. Set `failOpen: true` to let calls through in that case instead.
 */

// Deprecated (printed once per process, when this module is first loaded).
process.emitWarning('@mastyf_ai/langchain-middleware is deprecated: use @mastyf_ai/guard/langchain, which checks tool calls on your own machine without a proxy.', { type: 'DeprecationWarning', code: 'MASTYF_DEP_LANGCHAIN_MIDDLEWARE' });

export type MastyfMode = 'audit' | 'warn' | 'block';

export interface MastyfMiddlewareConfig {
  proxyUrl: string;
  apiKey?: string;
  tenantId?: string;
  /** block (default): deny what the policy denies. warn: log it and run anyway. audit: don't check. */
  mode?: MastyfMode;
  /** Run tool calls when the proxy can't give an answer. Default false (block them). */
  failOpen?: boolean;
  timeoutMs?: number;
  skipTools?: string[];
  identityContext?: {
    userId?: string;
    scopes?: string[];
    clientId?: string;
  };
}

export interface MastyfEvaluation {
  allowed: boolean;
  action: 'pass' | 'block' | 'flag';
  rule: string;
  reason: string;
  riskScore?: number;
  detections?: string[];
  latencyMs: number;
}

export interface EvaluationResponse {
  evaluation: MastyfEvaluation;
  sanitizedInput?: Record<string, unknown>;
}

function resolveMode(config: MastyfMiddlewareConfig): MastyfMode {
  return config.mode ?? 'block';
}

/** The proxy gave no usable answer: block unless the caller opted into failOpen. */
function unavailable(config: MastyfMiddlewareConfig, rule: string, reason: string, latencyMs: number): MastyfEvaluation {
  const allowed = config.failOpen === true;
  return { allowed, action: allowed ? 'pass' : 'block', rule, reason, latencyMs };
}

async function evaluateToolCall(
  toolName: string,
  serverName: string,
  args: Record<string, unknown>,
  config: MastyfMiddlewareConfig,
): Promise<MastyfEvaluation> {
  const mode = resolveMode(config);
  const start = Date.now();
  const baseUrl = config.proxyUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  if (config.tenantId) {
    headers['X-Tenant-Id'] = config.tenantId;
  }
  if (config.identityContext?.userId) {
    headers['X-User-Id'] = config.identityContext.userId;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 10_000);

  try {
    const res = await fetch(`${baseUrl}/api/policy/test`, {
      method: 'POST',
      headers,
      // `arguments` / `mode` are what /api/policy/test reads; `args` / `blockingMode` were ignored.
      body: JSON.stringify({
        tool: toolName,
        server: serverName,
        arguments: args,
        mode,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return unavailable(config, 'proxy-unavailable', `Mastyf proxy returned HTTP ${res.status}`, Date.now() - start);
    }

    const data = await res.json();
    const latencyMs = Date.now() - start;

    if (data?.action !== 'pass' && data?.action !== 'flag' && data?.action !== 'block') {
      return unavailable(config, 'proxy-bad-response', 'Mastyf proxy returned an unrecognised response', latencyMs);
    }

    return {
      // A flag is a deny in block mode and a warning otherwise.
      allowed: data.action === 'pass' || (data.action === 'flag' && mode !== 'block'),
      action: data.action,
      rule: data.rule || 'unknown',
      reason: data.reason || '',
      riskScore: data.riskScore,
      detections: data.detections,
      latencyMs,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    return unavailable(
      config,
      'proxy-unreachable',
      `Mastyf proxy unreachable: ${err?.message || String(err)}`,
      Date.now() - start,
    );
  }
}

/** Throws in block mode when the call is denied; warns in warn mode; skips in audit mode. */
async function enforce(
  toolName: string,
  serverName: string,
  args: Record<string, unknown>,
  config: MastyfMiddlewareConfig,
  errorPrefix: string,
): Promise<void> {
  const mode = resolveMode(config);
  if (mode === 'audit') return;

  const evaluation = await evaluateToolCall(toolName, serverName, args, config);
  if (evaluation.allowed) {
    if (evaluation.action === 'flag') {
      console.warn(`[Mastyf AI] Tool "${toolName}" flagged: ${evaluation.reason}`);
    }
    return;
  }
  if (mode === 'warn') {
    console.warn(`[Mastyf AI] Tool "${toolName}" would be blocked: ${evaluation.reason} (rule: ${evaluation.rule})`);
    return;
  }
  const error = new Error(`${errorPrefix}: ${evaluation.reason} (rule: ${evaluation.rule})`);
  (error as any).mastyfEvaluation = evaluation;
  throw error;
}

export function createMastyfToolWrapper<TSchema extends Record<string, any> = Record<string, any>>(
  baseTool: any,
  config: MastyfMiddlewareConfig,
): any {
  const toolName = baseTool.name || baseTool.constructor?.name || 'unknown';
  const serverName = config.identityContext?.clientId || 'langchain-agent';

  if (config.skipTools && config.skipTools.includes(toolName)) {
    return baseTool;
  }

  const mode = resolveMode(config);

  const wrappedCall = async (input: TSchema, runManager?: any): Promise<any> => {
    const args = typeof input === 'object' && input !== null ? { ...input } : { input };

    await enforce(toolName, serverName, args, config, `Mastyf AI blocked tool "${toolName}"`);

    const result = await baseTool.call(input, runManager);

    if (mode !== 'audit') {
      const start = Date.now();
      try {
        await fetch(`${config.proxyUrl.replace(/\/$/, '')}/api/policy/test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            ...(config.tenantId ? { 'X-Tenant-Id': config.tenantId } : {}),
          },
          body: JSON.stringify({
            tool: `${toolName}_response`,
            server: serverName,
            arguments: { response: typeof result === 'string' ? result : JSON.stringify(result) },
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {}
    }

    return result;
  };

  return {
    ...baseTool,
    name: toolName,
    call: wrappedCall,
    invoke: wrappedCall,
  };
}

export function createMastyfAgentCallback(config: MastyfMiddlewareConfig): any {
  let toolCallCount = 0;
  const toolCalls: Array<{ tool: string; args: Record<string, unknown>; timestamp: string }> = [];

  return {
    name: 'mastyf-security-callback',

    async handleToolStart(tool: { name: string }, input: string): Promise<void> {
      toolCallCount++;
      // Plain-string tool input is still checked, as { input }; it used to skip the check.
      let args: Record<string, unknown>;
      try {
        const parsed = JSON.parse(input);
        args = parsed && typeof parsed === 'object' ? parsed : { input: parsed };
      } catch {
        args = { input };
      }
      toolCalls.push({
        tool: tool.name,
        args,
        timestamp: new Date().toISOString(),
      });

      await enforce(tool.name, config.identityContext?.clientId || 'langchain-agent', args, config, 'Mastyf AI blocked');
    },

    getStats() {
      return {
        toolCallCount,
        toolCalls,
      };
    },
  };
}
