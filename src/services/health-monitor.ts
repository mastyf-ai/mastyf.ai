import { McpServerConfig, HealthReport } from '../types.js';
import { HistoryDatabase } from '../database/history-db.js';
import { McpClient } from '../utils/mcp-client.js';

/**
 * Simple latency and reliability tracking for MCP servers.
 * Tracks success rates from historical data and estimates tool count.
 */
export class HealthMonitor {
  private db: HistoryDatabase;

  constructor(db: HistoryDatabase) {
    this.db = db;
  }

  /**
   * Check health for a single server.
   */
  async checkServer(server: McpServerConfig): Promise<HealthReport> {
    const start = Date.now();

    // Attempt a quick probe
    const probe = await McpClient.probe(server);
    const latency = Date.now() - start;

    // Get historical success rate from DB
    const historicalRate = await this.db.getRecentSuccessRate(server.name);
    const successRate = probe.success ? Math.max(historicalRate, 0.5) : Math.min(historicalRate, 0.5);

    const toolCount = probe.toolCount;
    const overloadWarning = toolCount > 15; // empirical threshold
    const contextPressure = toolCount > 10 ? 0.7 : toolCount > 5 ? 0.4 : 0.2;

    return {
      serverName: server.name,
      latencyMs: latency,
      successRate: Math.round(successRate * 100) / 100,
      contextPressure: Math.round(contextPressure * 100) / 100,
      toolCount,
      overloadWarning,
      recommendations: generateHealthRecs(overloadWarning, toolCount, latency),
    };
  }
}

function generateHealthRecs(overload: boolean, toolCount: number, latency: number): string[] {
  const recs: string[] = [];
  if (overload) {
    recs.push(`Reduce number of tools (currently ${toolCount}) to avoid agent confusion — consider grouping into named subtools`);
  }
  if (toolCount > 20) {
    recs.push('Consider splitting into multiple smaller servers for better reliability');
  }
  if (latency > 2000) {
    recs.push(`Server response is slow (${latency}ms) — check network connectivity or server implementation`);
  }
  if (latency > 5000) {
    recs.push(`Server response is extremely slow (${latency}ms) — consider optimizing startup or using a faster transport`);
  }
  if (recs.length === 0) {
    recs.push('Server appears healthy');
  }
  return recs;
}