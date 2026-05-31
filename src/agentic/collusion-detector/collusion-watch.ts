/** #5 Agent-to-Agent Collusion Detection */
import { Logger } from '../../utils/logger.js';
import {
  buildSessionChainGraph,
  detectChainPatterns,
  type SessionChainGraph,
} from '../../policy/session-chain-detector.js';
import { IndustryStandardStore } from '../../database/industry-standard-store.js';

export interface CollusionAlert {
  alertId: string; pattern: 'recon_then_exploit' | 'coordinated_exfil' | 'token_share';
  agents: string[]; tools: string[]; confidence: number; timestamp: string; description: string;
}

const READ_TOOLS = new Set(['list_directory', 'list_files', 'search_files', 'read_file', 'read']);
const EXFIL_TOOLS = new Set(['http_request', 'post_webhook', 'send_message', 'upload', 'fetch', 'curl']);
const EXPLOIT_TOOLS = new Set(['read_file', 'read', 'execute_command', 'bash', 'write_file']);

type AgentEvent = { agentId: string; toolName: string; at: number; sessionId?: string; tokenHint?: string };

export class CollusionDetector {
  private sessions = new Map<string, AgentEvent[]>();
  private tokenMap = new Map<string, Set<string>>();
  private alerts: CollusionAlert[] = [];

  constructor(private readonly store?: IndustryStandardStore) {}

  record(
    agentId: string,
    serverName: string,
    toolName: string,
    opts?: { sessionId?: string; tokenHint?: string; blocked?: boolean },
  ): CollusionAlert | null {
    if (!this.sessions.has(serverName)) this.sessions.set(serverName, []);
    const events = this.sessions.get(serverName)!;
    events.push({
      agentId,
      toolName,
      at: Date.now(),
      sessionId: opts?.sessionId,
      tokenHint: opts?.tokenHint,
    });
    if (events.length > 200) events.splice(0, events.length - 200);

    this.store?.recordChainEvent({
      sessionId: opts?.sessionId ?? serverName,
      agentId,
      serverName,
      toolName,
      eventType: 'collusion_observation',
      blocked: opts?.blocked ?? false,
    });

    const alert =
      this.detectReconThenExploit(serverName, events) ??
      this.detectCoordinatedExfil(serverName, events) ??
      this.detectTokenShare(serverName, events);

    if (alert) {
      this.alerts.push(alert);
      this.store?.recordChainEvent({
        sessionId: opts?.sessionId ?? serverName,
        agentId: alert.agents.join(','),
        serverName,
        toolName: alert.tools.join('->'),
        eventType: alert.pattern,
        edgeJson: JSON.stringify(alert),
        blocked: true,
      });
      Logger.warn(`[CollusionDetector] ${alert.description}`);
    }
    return alert;
  }

  private graphFromEvents(events: AgentEvent[]): SessionChainGraph {
    const nodes = events.map(e => ({
      toolName: e.toolName,
      at: e.at,
      sensitiveRead: READ_TOOLS.has(e.toolName),
      encodeHint: false,
      exfilHint: EXFIL_TOOLS.has(e.toolName),
    }));
    const edges = [];
    for (let i = 1; i < nodes.length; i++) {
      edges.push({ from: i - 1, to: i, kind: 'temporal' as const });
    }
    return { sessionKey: 'collusion', nodes, edges };
  }

  private detectReconThenExploit(serverName: string, events: AgentEvent[]): CollusionAlert | null {
    const byAgent = new Map<string, AgentEvent[]>();
    for (const e of events) {
      if (!byAgent.has(e.agentId)) byAgent.set(e.agentId, []);
      byAgent.get(e.agentId)!.push(e);
    }
    const agents = [...byAgent.keys()];
    if (agents.length < 2) return null;

    for (let i = 0; i < agents.length; i++) {
      for (let j = 0; j < agents.length; j++) {
        if (i === j) continue;
        const recon = byAgent.get(agents[i]!)!.find(e => READ_TOOLS.has(e.toolName) && e.toolName.startsWith('list'));
        const exploit = byAgent.get(agents[j]!)!.find(e => EXPLOIT_TOOLS.has(e.toolName));
        if (recon && exploit && recon.at < exploit.at && exploit.at - recon.at < 120_000) {
          const graph = this.graphFromEvents([recon, exploit]);
          const patterns = detectChainPatterns(graph);
          const confidence = patterns.length ? patterns[0]!.confidence : 0.7;
          return {
            alertId: `col-recon-${Date.now()}`,
            pattern: 'recon_then_exploit',
            agents: [agents[i]!, agents[j]!],
            tools: [recon.toolName, exploit.toolName],
            confidence,
            timestamp: new Date().toISOString(),
            description: `Agent ${agents[i]} probed, agent ${agents[j]} exploited on ${serverName}`,
          };
        }
      }
    }
    return null;
  }

  private detectCoordinatedExfil(serverName: string, events: AgentEvent[]): CollusionAlert | null {
    const recent = events.filter(e => Date.now() - e.at < 60_000 && EXFIL_TOOLS.has(e.toolName));
    const agents = [...new Set(recent.map(e => e.agentId))];
    if (agents.length < 2) return null;

    const graph = buildSessionChainGraph('collusion', recent.map(e => ({
      toolName: e.toolName,
      at: e.at,
      sensitiveRead: false,
      dataAccess: false,
    })));
    const patterns = detectChainPatterns(graph).filter(p => p.pattern.includes('exfil'));
    const confidence = patterns[0]?.confidence ?? 0.75;
    return {
      alertId: `col-exfil-${Date.now()}`,
      pattern: 'coordinated_exfil',
      agents,
      tools: recent.map(e => e.toolName),
      confidence,
      timestamp: new Date().toISOString(),
      description: `${agents.length} agents coordinated exfil on ${serverName}`,
    };
  }

  private detectTokenShare(_serverName: string, events: AgentEvent[]): CollusionAlert | null {
    for (const e of events) {
      if (!e.tokenHint) continue;
      if (!this.tokenMap.has(e.tokenHint)) this.tokenMap.set(e.tokenHint, new Set());
      this.tokenMap.get(e.tokenHint)!.add(e.agentId);
    }
    for (const [token, agentSet] of this.tokenMap) {
      const agents = [...agentSet];
      if (agents.length >= 2) {
        return {
          alertId: `col-token-${Date.now()}`,
          pattern: 'token_share',
          agents,
          tools: events.filter(e => e.tokenHint === token).map(e => e.toolName),
          confidence: 0.8,
          timestamp: new Date().toISOString(),
          description: `Shared token/session hint detected across agents: ${agents.join(', ')}`,
        };
      }
    }
    return null;
  }

  getAlerts(): CollusionAlert[] { return this.alerts; }
}
