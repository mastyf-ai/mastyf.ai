import { CostReport, ToolCost, McpServerConfig, ProxyCallRecord } from '../types.js';
import { TokenCounter } from '../utils/token-counter.js';
import { IDatabase } from '../database/database-interface.js';
import { Logger } from '../utils/logger.js';
import { getRuntimeModelPricing } from './runtime-model-pricing.js';
import { resolveModelId } from '../config/llm-config.js';

/** Daily spend cap from GUARDIAN_DAILY_BUDGET_USD (preferred) or MCP_GUARDIAN_COST_BUDGET. */
export function getDailyBudgetCapUsd(): number {
  const daily = process.env['GUARDIAN_DAILY_BUDGET_USD'] ?? process.env['MCP_GUARDIAN_COST_BUDGET'];
  if (!daily) return 0;
  const cap = parseFloat(daily);
  return Number.isFinite(cap) && cap > 0 ? cap : 0;
}

export class CostAuditor {
  private tokenCounter: TokenCounter;
  private db: IDatabase | undefined;

  constructor(_pricingClient?: unknown, db?: IDatabase, _pricingModel?: string) {
    this.tokenCounter = new TokenCounter();
    this.db = db;
  }

  /** Sum costUsd for all servers since UTC midnight. */
  async getDailySpendUsd(): Promise<number> {
    if (!this.db) return 0;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const cutoff = startOfDay.toISOString();
    let total = 0;
    try {
      const names = await this.db.getDistinctActiveServers();
      for (const name of names) {
        const records = await this.db.getCallRecordsForServer(name);
        for (const r of records) {
          const ts = Date.parse(r.timestamp);
          if (!Number.isNaN(ts) && ts >= startOfDay.getTime()) {
            total += r.costUsd ?? 0;
          }
        }
      }
    } catch (err: unknown) {
      Logger.warn(
        `Cost audit: daily spend read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return Math.round(total * 10000) / 10000;
  }

  async isDailyBudgetExceeded(): Promise<{
    exceeded: boolean;
    spentUsd: number;
    capUsd: number;
  }> {
    const capUsd = getDailyBudgetCapUsd();
    if (capUsd <= 0) {
      return { exceeded: false, spentUsd: 0, capUsd: 0 };
    }
    const spentUsd = await this.getDailySpendUsd();
    return { exceeded: spentUsd >= capUsd, spentUsd, capUsd };
  }

  async getPricingModel(): Promise<string> {
    const active = await getRuntimeModelPricing().getActivePricing();
    if (active) return `${active.displayName} (${active.source})`;
    return resolveModelId() || 'no model detected';
  }

  async auditServer(server: McpServerConfig): Promise<CostReport> {
    if (!this.db) {
      return this.emptyReport(server.name, 'Database not available. Ensure the proxy has been configured.');
    }

    try {
      const records = await this.db.getCallRecordsForServer(server.name);
      if (records.length > 0) {
        return this.buildReportFromRecords(server.name, records);
      }
    } catch (err: unknown) {
      Logger.warn(`Cost audit: DB read failed for ${server.name}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return this.emptyReport(server.name, 'No recorded call data. Use `mcp-guardian proxy` to capture real token usage.');
  }

  private emptyReport(serverName: string, note: string): CostReport {
    return {
      serverName,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUSD: 0,
      actualCostUSD: 0,
      pricingModel: 'none',
      pricingSources: [],
      toolBreakdown: [],
      unpricedCalls: 0,
      note,
    };
  }

  private async buildReportFromRecords(serverName: string, records: ProxyCallRecord[]): Promise<CostReport> {
    const pricing = getRuntimeModelPricing();
    const toolMap = new Map<string, { inputTokens: number; outputTokens: number; calls: number; cost: number; models: Set<string> }>();
    const sources = new Set<string>();
    let totalInput = 0;
    let totalOutput = 0;
    let actualCostUSD = 0;
    let unpricedCalls = 0;
    let apiSourcedCalls = 0;
    let estimatedCalls = 0;
    const active = await pricing.getActivePricing();
    const pricingModel = active?.displayName || active?.modelId || 'unresolved';

    for (const r of records) {
      if (r.tokenSource === 'api') apiSourcedCalls++;
      else if (r.tokenSource === 'estimated') estimatedCalls++;

      const existing = toolMap.get(r.toolName) || {
        inputTokens: 0, outputTokens: 0, calls: 0, cost: 0, models: new Set<string>(),
      };
      existing.inputTokens += r.requestTokens;
      existing.outputTokens += r.responseTokens;
      existing.calls += 1;

      let callCost = r.costUsd ?? 0;
      if (callCost <= 0 && r.model) {
        const resolved = await pricing.resolveModelId(r.model);
        if (resolved) {
          callCost = pricing.computeCost(r.requestTokens, r.responseTokens, resolved).costUsd;
          if (callCost > 0) sources.add(resolved.source);
        }
      } else if (callCost > 0 && r.pricingSource) {
        sources.add(r.pricingSource);
      }

      if (callCost > 0) {
        existing.cost += callCost;
        actualCostUSD += callCost;
      } else if ((r.requestTokens || 0) + (r.responseTokens || 0) > 0) {
        unpricedCalls++;
      }

      if (r.model) existing.models.add(r.model);
      toolMap.set(r.toolName, existing);
      totalInput += r.requestTokens;
      totalOutput += r.responseTokens;
    }

    if (active) sources.add(active.source);

    const breakdown: ToolCost[] = [];
    for (const [toolName, data] of toolMap) {
      breakdown.push({
        toolName,
        tokens: data.inputTokens + data.outputTokens,
        calls: data.calls,
        cost: Math.round(data.cost * 10000) / 10000,
      });
    }

    return {
      serverName,
      tokensUsed: totalInput + totalOutput,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      estimatedCostUSD: Math.round(actualCostUSD * 10000) / 10000,
      actualCostUSD: Math.round(actualCostUSD * 10000) / 10000,
      pricingModel,
      pricingSources: [...sources],
      toolBreakdown: breakdown,
      unpricedCalls,
      note: [
        unpricedCalls > 0
          ? `${unpricedCalls} call(s) could not be priced — ensure Cline is active or set GUARDIAN_MODEL`
          : null,
        apiSourcedCalls > 0 || estimatedCalls > 0
          ? `Token sources: ${apiSourcedCalls} API, ${estimatedCalls} estimated (USD only)`
          : null,
      ]
        .filter(Boolean)
        .join('; ') || undefined,
    };
  }

  countTokens(text: string): number {
    return this.tokenCounter.count(text);
  }

  dispose(): void {
    this.tokenCounter.free();
  }
}
