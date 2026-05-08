import { CostReport, ToolCost, McpServerConfig } from '../types.js';
import { TokenCounter } from '../utils/token-counter.js';
import { PricingClient } from '../clients/pricing-client.js';

/**
 * Estimates token usage and costs per MCP server.
 * In a full implementation, this would parse actual MCP call logs.
 * For MVP, it provides an estimation based on tool schemas and typical usage.
 */
export class CostAuditor {
  private tokenCounter: TokenCounter;
  private pricing: PricingClient;

  constructor(pricingClient?: PricingClient) {
    this.tokenCounter = new TokenCounter();
    this.pricing = pricingClient || new PricingClient();
  }

  /**
   * Audit costs for a server. If recentCalls is provided, use real data;
   * otherwise, generate a sample estimate based on typical MCP tool usage.
   */
  async auditServer(
    server: McpServerConfig,
    recentCalls?: { toolName: string; tokens: number; calls: number }[]
  ): Promise<CostReport> {
    const toolCosts: ToolCost[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const sampleCalls: { toolName: string; tokens: number; calls: number }[] = recentCalls ?? [
      { toolName: 'search', tokens: 2000, calls: 5 },
      { toolName: 'read_file', tokens: 500, calls: 10 },
      { toolName: 'execute_command', tokens: 800, calls: 4 },
      { toolName: 'write_to_file', tokens: 1500, calls: 3 },
    ];

    // Use a default pricing model — could be made configurable
    const pricingModel = 'gpt-4o';

    for (const call of sampleCalls) {
      const totalTokens = call.tokens * call.calls;
      const inputTokens = totalTokens * 0.7; // rough 70/30 split
      const outputTokens = totalTokens * 0.3;

      const cost =
        this.pricing.calculateCost(inputTokens, pricingModel, false) +
        this.pricing.calculateCost(outputTokens, pricingModel, true);

      toolCosts.push({
        toolName: call.toolName,
        tokens: totalTokens,
        calls: call.calls,
        cost,
      });

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
    }

    const totalCost = toolCosts.reduce((sum, t) => sum + t.cost, 0);
    return {
      serverName: server.name,
      tokensUsed: totalInputTokens + totalOutputTokens,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCostUSD: Math.round(totalCost * 10000) / 10000, // round to 4 decimals
      pricingModel,
      toolBreakdown: toolCosts,
    };
  }

  /**
   * Count tokens in a text string using tiktoken.
   */
  countTokens(text: string): number {
    return this.tokenCounter.count(text);
  }

  /**
   * Release the tiktoken encoding to free memory.
   */
  dispose(): void {
    this.tokenCounter.free();
  }
}