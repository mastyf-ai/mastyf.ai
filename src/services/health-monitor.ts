import { McpServerConfig, HealthReport } from '../types.js';
import { HistoryDatabase } from '../database/history-db.js';
import { McpClient, McpProbeResult } from '../utils/mcp-client.js';

export class HealthMonitor {
  private db: HistoryDatabase;

  constructor(db: HistoryDatabase) {
    this.db = db;
  }

  async checkServer(server: McpServerConfig): Promise<HealthReport> {
    const start = Date.now();
    const probe: McpProbeResult = await McpClient.probe(server);
    const latency = probe.latencyMs || (Date.now() - start);

    const historicalRate = await this.db.getRecentSuccessRate(server.name);
    const successRate = probe.success
      ? (historicalRate !== null ? Math.max(historicalRate, 0.5) : 1.0)
      : (historicalRate !== null ? Math.min(historicalRate, 0.3) : 0.0);

    const toolCount = probe.toolCount ?? 0;
    const overloadWarning = toolCount > 15;
    const contextPressure = toolCount > 10 ? 0.7 : toolCount > 5 ? 0.4 : 0.2;

    const recs: string[] = [];
    if (overloadWarning) {
      recs.push(`Reduce number of tools (currently ${toolCount}) to avoid agent confusion — consider grouping into named subtools`);
    }
    if (toolCount > 20) {
      recs.push('Consider splitting into multiple smaller servers for better reliability');
    }
    if (!probe.success && probe.authRequired) {
      recs.push('Server requires authentication — ensure credentials are configured');
    }
    if (!probe.success && probe.error) {
      recs.push(`Probe failed: ${probe.error}`);
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

    return {
      serverName: server.name,
      latencyMs: latency,
      successRate: Math.round(successRate * 100) / 100,
      contextPressure: Math.round(contextPressure * 100) / 100,
      toolCount,
      overloadWarning,
      recommendations: recs,
    };
  }
}