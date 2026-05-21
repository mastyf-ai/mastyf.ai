import type { McpToolDefinition } from './mcp-client.js';
import { TokenCounter, detectProvider } from './token-counter.js';
import { getRuntimeModelPricing } from '../services/runtime-model-pricing.js';
import type { ToolCost } from '../types.js';

/** Default simulated tool result size when opt-in estimates run. */
const DEFAULT_RESPONSE_CHARS = 512;

/** Agent context overhead added once per server when simulating calls (opt-in only). */
const CONTEXT_OVERHEAD_CHARS = 800;

export interface ToolCostEstimate {
  toolName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface ServerCostEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  toolBreakdown: ToolCost[];
  priced: boolean;
  pricingSources: string[];
  pricingModel: string;
  modelId: string;
  provider: string;
  unpricedTools: number;
}

export interface ModelListRates {
  modelId: string;
  provider: string;
  pricingModel: string;
  inputPerM: number;
  outputPerM: number;
  inputPer1k: number;
  outputPer1k: number;
  priced: boolean;
  pricingSources: string[];
}

/** Opt-in simulated per-tool costs (tools/list footprint). Off by default since v2.7.11. */
export function allowsCostEstimates(): boolean {
  return process.env.GUARDIAN_COST_ALLOW_ESTIMATES === 'true';
}

export type CostSource = 'actual' | 'model-only' | 'estimated' | 'none';

export function getCostSource(): CostSource {
  const raw = process.env.GUARDIAN_COST_SOURCE ?? 'model-only';
  if (raw === 'actual' || raw === 'model-only' || raw === 'estimated' || raw === 'none') {
    return raw;
  }
  return 'model-only';
}

/** Reject misleading cost sources in production unless explicitly opted in. */
export function validateCostSourceAtStartup(): void {
  const source = process.env.GUARDIAN_COST_SOURCE;
  if (!source) return;

  if (source === 'simulated') {
    throw new Error(
      `Cost source 'simulated' is not allowed. Use 'actual' (proxy traffic) or 'model-only' (list rates). ` +
        `For legacy tools/list simulation set GUARDIAN_COST_ALLOW_ESTIMATES=true and GUARDIAN_COST_SOURCE=estimated`,
    );
  }

  if (source === 'estimated' && !allowsCostEstimates()) {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd || process.env.GUARDIAN_STRICT_MODE === 'true') {
      throw new Error(
        `GUARDIAN_COST_SOURCE=estimated requires GUARDIAN_COST_ALLOW_ESTIMATES=true (not for production audit)`,
      );
    }
  }

  const allowed: CostSource[] = ['actual', 'model-only', 'estimated', 'none'];
  if (!allowed.includes(source as CostSource)) {
    throw new Error(`Unknown GUARDIAN_COST_SOURCE: ${source}`);
  }
}

/** Official list rates for a resolved model — no simulated call volume. */
export async function resolveModelListRates(modelId: string): Promise<ModelListRates> {
  const pricing = getRuntimeModelPricing();
  const resolved = await pricing.resolveModelId(modelId);
  const provider = detectProvider(modelId);
  const pricingModel = resolved?.displayName || resolved?.modelId || modelId;
  const sources = resolved ? [resolved.source] : [];

  return {
    modelId,
    provider,
    pricingModel,
    inputPerM: resolved?.inputPerM ?? 0,
    outputPerM: resolved?.outputPerM ?? 0,
    inputPer1k: resolved ? resolved.inputPerM / 1000 : 0,
    outputPer1k: resolved ? resolved.outputPerM / 1000 : 0,
    priced: resolved !== null,
    pricingSources: sources,
  };
}

/** Build minimal JSON arguments from JSON Schema (required fields only). */
export function minimalArgsFromSchema(schema?: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return {};
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props || typeof props !== 'object') return {};

  const required = Array.isArray(schema.required)
    ? (schema.required as string[])
    : Object.keys(props);

  const args: Record<string, unknown> = {};
  for (const key of required) {
    const prop = props[key];
    if (!prop) continue;
    const t = prop.type;
    if (t === 'string') args[key] = '';
    else if (t === 'number' || t === 'integer') args[key] = 0;
    else if (t === 'boolean') args[key] = false;
    else if (t === 'array') args[key] = [];
    else if (t === 'object') args[key] = {};
    else args[key] = null;
  }
  return args;
}

function toolsListContextText(tools: McpToolDefinition[]): string {
  return JSON.stringify(
    tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? {},
    })),
  );
}

function simulatedCallTexts(
  tool: McpToolDefinition,
  toolsContext: string,
): { requestText: string; responseText: string } {
  const args = minimalArgsFromSchema(tool.inputSchema);
  const callPayload = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: tool.name, arguments: args },
  };
  const requestText = toolsContext + '\n' + JSON.stringify(callPayload);
  const responseText = JSON.stringify({
    content: [{ type: 'text', text: 'x'.repeat(DEFAULT_RESPONSE_CHARS) }],
  });
  return { requestText, responseText };
}

/**
 * Estimate per-tool MCP cost from tool definitions.
 * Requires GUARDIAN_COST_ALLOW_ESTIMATES=true — not used by default audit path.
 */
export async function estimateServerCostFromTools(
  tools: McpToolDefinition[],
  modelId: string,
  tokenCounter?: TokenCounter,
): Promise<ServerCostEstimate> {
  const counter = tokenCounter ?? new TokenCounter();
  const pricing = getRuntimeModelPricing();
  const resolved = await pricing.resolveModelId(modelId);
  const provider = detectProvider(modelId);
  const pricingModel = resolved?.displayName || resolved?.modelId || modelId;
  const sources = new Set<string>();
  if (resolved) sources.add(resolved.source);

  const toolsContext =
    CONTEXT_OVERHEAD_CHARS > 0
      ? ' '.repeat(CONTEXT_OVERHEAD_CHARS) + toolsListContextText(tools)
      : toolsListContextText(tools);

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let unpricedTools = 0;
  const breakdown: ToolCost[] = [];

  for (const tool of tools) {
    const { requestText, responseText } = simulatedCallTexts(tool, toolsContext);
    const counts = counter.countProxyCall({
      requestText,
      responseText,
      model: modelId,
      requestPayload: { params: { arguments: minimalArgsFromSchema(tool.inputSchema) } },
      responsePayload: { result: { content: [{ type: 'text' }] } },
    });

    let costUsd = 0;
    if (resolved) {
      const cost = pricing.computeCost(counts.requestTokens, counts.responseTokens, resolved);
      costUsd = cost.costUsd;
      if (cost.priced) sources.add(resolved.source);
    } else {
      unpricedTools++;
    }

    totalInput += counts.requestTokens;
    totalOutput += counts.responseTokens;
    totalCost += costUsd;

    breakdown.push({
      toolName: tool.name,
      tokens: counts.requestTokens + counts.responseTokens,
      calls: 1,
      cost: Math.round(costUsd * 10000) / 10000,
    });
  }

  return {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    totalTokens: totalInput + totalOutput,
    costUsd: Math.round(totalCost * 10000) / 10000,
    toolBreakdown: breakdown,
    priced: resolved !== null && unpricedTools === 0,
    pricingSources: [...sources],
    pricingModel,
    modelId,
    provider,
    unpricedTools,
  };
}
