import { CostReport, ToolCost, McpServerConfig, ProxyCallRecord } from '../types.js';
import { TokenCounter } from '../utils/token-counter.js';
import { PricingClient } from '../clients/pricing-client.js';
import { HistoryDatabase } from '../database/history-db.js';
import { Logger } from '../utils/logger.js';

export class CostAuditor {
  private tokenCounter: TokenCounter;
  private pricing: PricingClient;
  private db: HistoryDatabase | undefined;
  private pricingModel: string;

  constructor(pricingClient?: PricingClient, db?: HistoryDatabase, pricingModel?: string) {
    this.tokenCounter = new TokenCounter();
    this.pricing = pricingClient || new PricingClient();
    this.db = db;
    this.pricingModel = pricingModel || process.env['MCP_PRICING_MODEL'] || 'gpt-4o';
  }

  /** Dynamically change the pricing model for cost estimation. */
  setPricingModel(model: string): void {
    this.pricingModel = model;
  }

  /** Returns the currently active pricing model. */
  getPricingModel(): string {
    return this.pricingModel;
  }

  async auditServer(server: McpServerConfig): Promise<CostReport> {
    if (!this.db) {
      return {
        serverName: server.name,
        tokensUsed: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUSD: 0,
        pricingModel: 'unknown',
        toolBreakdown: [],
        note: 'Database not available. Ensure the proxy has been configured.',
      };
    }

    try {
      const records = await this.db.getCallRecordsForServer(server.name);
      if (records.length > 0) {
        return this.buildReportFromRecords(server.name, records);
      }
    } catch (err: any) {
      Logger.warn(`Cost audit: DB read failed for ${server.name}: ${err?.message}`);
    }

    return {
      serverName: server.name,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUSD: 0,
      pricingModel: 'unknown',
      toolBreakdown: [],
      note: 'No recorded call data. Use `mcp-guardian proxy` to capture real token usage.',
    };
  }

  private buildReportFromRecords(serverName: string, records: ProxyCallRecord[]): CostReport {
    const model = this.pricingModel;
    const toolMap = new Map<string, { inputTokens: number; outputTokens: number; calls: number }>();

    for (const r of records) {
      const existing = toolMap.get(r.toolName) || { inputTokens: 0, outputTokens: 0, calls: 0 };
      existing.inputTokens += r.requestTokens;
      existing.outputTokens += r.responseTokens;
      existing.calls += 1;
      toolMap.set(r.toolName, existing);
    }

    const breakdown: ToolCost[] = [];
    let totalInput = 0;
    let totalOutput = 0;

    for (const [toolName, data] of toolMap) {
      const totalTokens = data.inputTokens + data.outputTokens;
      const inputCost = this.pricing.estimateCost(model, data.inputTokens, 0);
      const outputCost = this.pricing.estimateCost(model, 0, data.outputTokens);
      const cost = (inputCost ?? 0) + (outputCost ?? 0);

      breakdown.push({
        toolName,
        tokens: totalTokens,
        calls: data.calls,
        cost: Math.round(cost * 10000) / 10000,
      });
      totalInput += data.inputTokens;
      totalOutput += data.outputTokens;
    }

    const totalCost = breakdown.reduce((sum, t) => sum + t.cost, 0);
    return {
      serverName,
      tokensUsed: totalInput + totalOutput,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      estimatedCostUSD: Math.round(totalCost * 10000) / 10000,
      pricingModel: model,
      toolBreakdown: breakdown,
    };
  }

  countTokens(text: string): number {
    return this.tokenCounter.count(text);
  }

  dispose(): void {
    this.tokenCounter.free();
  }
}