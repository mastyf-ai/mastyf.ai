/**
 * Mastyf AI Security Middleware for LangChain
 *
 * Wraps LangChain tools with the Mastyf AI policy proxy, intercepting every
 * tool call for security evaluation before it reaches the actual tool
 * implementation. Supports audit, warn, and block modes.
 *
 * Usage:
 * ```ts
 * import { createMastyfToolWrapper } from '@mastyf-ai/langchain-middleware';
 *
 * const secureTools = tools.map(tool =>
 *   createMastyfToolWrapper(tool, {
 *     proxyUrl: 'http://localhost:4000',
 *     apiKey: process.env.MASTYF_AI_API_KEY,
 *     mode: 'block',
 *   })
 * );
 * ```
 */

export interface MastyfMiddlewareConfig {
  proxyUrl: string;
  apiKey?: string;
  tenantId?: string;
  mode?: 'audit' | 'warn' | 'block';
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

async function evaluateToolCall(
  toolName: string,
  serverName: string,
  args: Record<string, unknown>,
  config: MastyfMiddlewareConfig,
): Promise<MastyfEvaluation> {
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
      body: JSON.stringify({
        tool: toolName,
        server: serverName,
        args,
        blockingMode: config.mode,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const latencyMs = Date.now() - start;
      return {
        allowed: config.mode !== 'block',
        action: config.mode === 'block' ? 'block' : 'pass',
        rule: 'proxy-unavailable',
        reason: `Mastyf proxy returned HTTP ${res.status}`,
        latencyMs,
      };
    }

    const data = await res.json();
    const latencyMs = Date.now() - start;

    return {
      allowed: data.action === 'pass' || (data.action === 'flag' && config.mode !== 'block'),
      action: data.action || 'pass',
      rule: data.rule || 'unknown',
      reason: data.reason || '',
      riskScore: data.riskScore,
      detections: data.detections,
      latencyMs,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    return {
      allowed: config.mode !== 'block',
      action: config.mode === 'block' ? 'block' : 'pass',
      rule: 'proxy-unreachable',
      reason: `Mastyf proxy unreachable: ${err.message}`,
      latencyMs,
    };
  }
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

  const safeConfig: Required<Pick<MastyfMiddlewareConfig, 'mode' | 'timeoutMs'>> = {
    mode: config.mode || 'block',
    timeoutMs: config.timeoutMs || 10_000,
  };

  const wrappedCall = async (input: TSchema, runManager?: any): Promise<any> => {
    const args = typeof input === 'object' ? { ...input } : { input };

    if (safeConfig.mode !== 'audit') {
      const evaluation = await evaluateToolCall(toolName, serverName, args, config);

      if (!evaluation.allowed) {
        const errorMsg = `Mastyf AI blocked tool "${toolName}": ${evaluation.reason} (rule: ${evaluation.rule})`;
        const error = new Error(errorMsg);
        (error as any).mastyfEvaluation = evaluation;
        throw error;
      }

      if (evaluation.action === 'flag') {
        console.warn(`[Mastyf AI] Tool "${toolName}" flagged: ${evaluation.reason}`);
      }
    }

    const result = await baseTool.call(input, runManager);

    if (safeConfig.mode !== 'audit') {
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
            args: { response: typeof result === 'string' ? result : JSON.stringify(result) },
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
      try {
        const args = JSON.parse(input);
        toolCalls.push({
          tool: tool.name,
          args,
          timestamp: new Date().toISOString(),
        });

        const evaluation = await evaluateToolCall(
          tool.name,
          config.identityContext?.clientId || 'langchain-agent',
          args,
          config,
        );

        if (!evaluation.allowed) {
          const error = new Error(`Mastyf AI blocked: ${evaluation.reason}`);
          (error as any).mastyfEvaluation = evaluation;
          throw error;
        }
      } catch (err: any) {
        if (err.mastyfEvaluation) throw err;
      }
    },

    getStats() {
      return {
        toolCallCount,
        toolCalls,
      };
    },
  };
}
