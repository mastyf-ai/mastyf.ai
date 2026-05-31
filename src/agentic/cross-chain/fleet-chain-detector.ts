/**
 * A1 — Cross-MCP Causal Attack Chain Detection (fleet-wide session graph).
 */
import { randomUUID } from 'crypto';
import {
  buildSessionChainGraph,
  detectChainPatterns,
  type SessionChainGraph,
} from '../../policy/session-chain-detector.js';
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import { Logger } from '../../utils/logger.js';
import { buildIrSiemBundle, fleetAlertToCef } from './siem-export.js';
import { computeGraphNeuralScore } from './graph-scorer.js';
import { publishFleetEventToRedis } from './fleet-chain-redis.js';

/** Optional ONNX boost cached per session (A1). */
const onnxBoostCache = new Map<string, number>();

async function refreshGraphOnnxBoost(sessionId: string, events: FleetChainEvent[]): Promise<void> {
  if (!process.env.GUARDIAN_FLEET_GRAPH_ONNX_MODEL?.trim()) return;
  try {
    const { scoreGraphEventsWithOnnx } = await import('./graph-onnx-inference.js');
    const result = await scoreGraphEventsWithOnnx(events);
    if (result) onnxBoostCache.set(sessionId, result.score > 0.5 ? (result.score - 0.5) * 0.15 : 0);
  } catch {
    // best-effort
  }
}

export interface FleetChainEvent {
  globalSessionId: string;
  agentId: string;
  serverName: string;
  toolName: string;
  eventType: string;
  mitreTechnique?: string;
  blocked: boolean;
  timestamp: number;
  argumentsSnapshot?: Record<string, unknown>;
}

export interface FleetChainAlert {
  alertId: string;
  globalSessionId: string;
  agents: string[];
  servers: string[];
  tools: string[];
  pattern: string;
  mitreTechniques: string[];
  confidence: number;
  description: string;
  collusionCorrelated?: boolean;
}

const MITRE_MAP: Record<string, string> = {
  'read-encode-exfil': 'T1005',
  'read-then-exfil': 'T1048',
  'encode-then-exfil': 'T1041',
  'multi-step-staging': 'T1592',
};

export class FleetChainDetector {
  private events = new Map<string, FleetChainEvent[]>();
  private alerts: FleetChainAlert[] = [];

  constructor(private readonly store?: IndustryStandardStore) {}

  record(params: {
    globalSessionId: string;
    agentId: string;
    serverName: string;
    toolName: string;
    eventType?: string;
    blocked?: boolean;
    arguments?: Record<string, unknown>;
  }): FleetChainAlert | null {
    const sessionId = params.globalSessionId;
    const list = this.hydrateSessionEvents(sessionId);
    const argsSnapshot = params.arguments
      ? { ...params.arguments, server: params.serverName }
      : { server: params.serverName };
    const evt: FleetChainEvent = {
      globalSessionId: sessionId,
      agentId: params.agentId,
      serverName: params.serverName,
      toolName: params.toolName,
      eventType: params.eventType ?? 'tool_call',
      blocked: params.blocked ?? false,
      timestamp: Date.now(),
      argumentsSnapshot: argsSnapshot,
    };
    list.push(evt);
    if (list.length > 300) list.splice(0, list.length - 300);
    this.events.set(sessionId, list);

    this.store?.saveFleetChainEvent?.({
      globalSessionId: sessionId,
      agentId: params.agentId,
      serverName: params.serverName,
      toolName: params.toolName,
      eventType: evt.eventType,
      blocked: evt.blocked,
      edgeJson: argsSnapshot,
    });

    void publishFleetEventToRedis({
      globalSessionId: sessionId,
      agentId: params.agentId,
      serverName: params.serverName,
      toolName: params.toolName,
      eventType: evt.eventType,
      blocked: evt.blocked,
      timestamp: evt.timestamp,
      edgeJson: argsSnapshot,
    });

    void this.mergeRedisEvents(sessionId);
    void refreshGraphOnnxBoost(sessionId, list);

    return this.detectCrossServerChain(sessionId, list);
  }
  private async mergeRedisEvents(sessionId: string): Promise<void> {
    try {
      const { listFleetEventsFromRedis } = await import('./fleet-chain-redis.js');
      const remote = await listFleetEventsFromRedis(sessionId);
      if (!remote.length) return;
      const list = this.events.get(sessionId) ?? [];
      for (const r of remote) {
        const dup = list.some(
          m => m.serverName === r.serverName
            && m.toolName === r.toolName
            && Math.abs(m.timestamp - r.timestamp) < 50,
        );
        if (!dup) {
          list.push({
            globalSessionId: r.globalSessionId,
            agentId: r.agentId,
            serverName: r.serverName,
            toolName: r.toolName,
            eventType: r.eventType,
            blocked: r.blocked,
            timestamp: r.timestamp,
            argumentsSnapshot: r.edgeJson,
          });
        }
      }
      if (list.length > 300) list.splice(0, list.length - 300);
      this.events.set(sessionId, list);
    } catch {
      /* best-effort */
    }
  }

  /** Merge persisted fleet events (multi-replica / restart safe) with in-memory buffer. */
  private hydrateSessionEvents(sessionId: string): FleetChainEvent[] {
    const cached = this.events.get(sessionId) ?? [];
    if (!this.store?.listFleetChainEvents) {
      return cached;
    }
    const persisted = this.store.listFleetChainEvents(sessionId);
    if (!persisted.length && !cached.length) {
      return [];
    }
    const merged: FleetChainEvent[] = persisted.map(p => ({
      globalSessionId: p.globalSessionId,
      agentId: p.agentId,
      serverName: p.serverName,
      toolName: p.toolName,
      eventType: p.eventType,
      mitreTechnique: p.mitreTechnique,
      blocked: p.blocked,
      timestamp: Date.parse(p.createdAt) || Date.now(),
      argumentsSnapshot: p.edgeJson ?? { server: p.serverName },
    }));
    for (const e of cached) {
      const dup = merged.some(
        m => m.serverName === e.serverName
          && m.toolName === e.toolName
          && Math.abs(m.timestamp - e.timestamp) < 50,
      );
      if (!dup) merged.push(e);
    }
    if (merged.length > 300) merged.splice(0, merged.length - 300);
    this.events.set(sessionId, merged);
    return merged;
  }

  private detectCrossServerChain(sessionId: string, events: FleetChainEvent[]): FleetChainAlert | null {
    const servers = new Set(events.map(e => e.serverName));
    if (servers.size < 2) return null;

    const graph = this.toSessionGraph(sessionId, events);
    const patterns = detectChainPatterns(graph);
    if (!patterns.length) return null;

    const pattern = patterns[0];
    const mitre = MITRE_MAP[pattern.pattern] ?? 'T1190';
    const gnnScore = computeGraphNeuralScore(events, pattern.confidence);
    const onnxBoost = onnxBoostCache.get(sessionId) ?? 0;
    const confidence = Math.min(0.99, gnnScore + onnxBoost);
    const collusionCorrelated = events.length >= 2
      && new Set(events.map(e => e.agentId)).size >= 2;

    const alert: FleetChainAlert = {
      alertId: randomUUID(),
      globalSessionId: sessionId,
      agents: [...new Set(events.map(e => e.agentId))],
      servers: [...servers],
      tools: events.slice(-8).map(e => `${e.serverName}:${e.toolName}`),
      pattern: pattern.pattern,
      mitreTechniques: [mitre],
      confidence,
      description: `Cross-server chain (${pattern.pattern}) spanning ${servers.size} servers` +
        (collusionCorrelated ? ' [multi-agent correlated]' : ''),
      collusionCorrelated,
    };
    this.alerts.push(alert);
    this.store?.saveFleetChainAlert?.(alert);
    Logger.warn(`[FleetChainDetector] ${alert.description}`);
    void this.emitSiemAlert(alert);
    void this.triggerIncidentPlaybook(alert);
    return alert;
  }

  private async triggerIncidentPlaybook(alert: FleetChainAlert): Promise<void> {
    try {
      const { ensureAgenticContainer } = await import('../../utils/agentic-container.js');
      const container = await ensureAgenticContainer();
      container?.incidentPlaybook.run(
        'cross_mcp_chain',
        'fleet-chain-detector',
        alert.confidence >= 0.75 ? 'critical' : 'high',
        'shell_injection',
        { agentId: alert.agents[0], recentCalls: alert.tools.length },
      );
    } catch {
      /* best-effort */
    }
  }

  private async emitSiemAlert(alert: FleetChainAlert): Promise<void> {
    try {
      const { exportSiemEvent } = await import('../../utils/enterprise-bootstrap.js');
      const cef = fleetAlertToCef(alert);
      await exportSiemEvent('fleet_chain_alert', {
        alertId: alert.alertId,
        pattern: alert.pattern,
        confidence: alert.confidence,
        mitreTechniques: alert.mitreTechniques,
        agents: alert.agents,
        servers: alert.servers,
        cefLine: cef,
      });
    } catch {
      /* best-effort */
    }
  }

  private toSessionGraph(sessionId: string, events: FleetChainEvent[]): SessionChainGraph {
    return buildSessionChainGraph(
      sessionId,
      events.map(e => ({
        toolName: e.toolName,
        at: e.timestamp,
        sensitiveRead: /read|list|search|get/i.test(e.toolName),
        dataAccess: true,
        argumentsSnapshot: e.argumentsSnapshot ?? { server: e.serverName },
      })),
    );
  }

  getAlerts(limit = 50): FleetChainAlert[] {
    const persisted = this.store?.listFleetChainAlerts?.(undefined, limit) ?? [];
    const fromDb: FleetChainAlert[] = persisted.map(p => ({
      alertId: p.alertId,
      globalSessionId: p.globalSessionId,
      agents: p.agents,
      servers: p.servers,
      tools: p.tools,
      pattern: p.pattern,
      mitreTechniques: p.mitreTechniques,
      confidence: p.confidence,
      description: p.description,
    }));
    const merged = [...fromDb];
    for (const a of this.alerts) {
      if (!merged.some(m => m.alertId === a.alertId)) merged.push(a);
    }
    return merged.slice(-limit);
  }

  exportIrBundle(sessionId: string): Record<string, unknown> {
    const events = this.hydrateSessionEvents(sessionId);
    const relatedAlerts = this.alerts.filter(a => a.globalSessionId === sessionId);
    return {
      sessionId,
      eventCount: events.length,
      events,
      alerts: relatedAlerts,
      exportedAt: new Date().toISOString(),
    };
  }

  exportSiemBundle(sessionId?: string): ReturnType<typeof buildIrSiemBundle> {
    if (sessionId) {
      const events = this.hydrateSessionEvents(sessionId);
      const alerts = this.alerts.filter(a => a.globalSessionId === sessionId);
      return buildIrSiemBundle({ sessionId, events, alerts });
    }
    const allEvents: FleetChainEvent[] = [];
    for (const list of this.events.values()) allEvents.push(...list);
    return buildIrSiemBundle({
      sessionId: 'fleet-wide',
      events: allEvents.slice(-500),
      alerts: this.alerts,
    });
  }

  /** Graph nodes/edges for dashboard visualization (A1). */
  exportChainGraph(sessionId?: string): {
    nodes: Array<{ id: string; label: string; type: 'agent' | 'server' | 'tool' }>;
    edges: Array<{ from: string; to: string; label: string; blocked?: boolean }>;
    alerts: FleetChainAlert[];
  } {
    const nodes = new Map<string, { id: string; label: string; type: 'agent' | 'server' | 'tool' }>();
    const edges: Array<{ from: string; to: string; label: string; blocked?: boolean }> = [];
    const events = sessionId
      ? this.hydrateSessionEvents(sessionId)
      : [...this.events.values()].flat().slice(-100);

    for (const e of events) {
      const agentId = `agent:${e.agentId}`;
      const serverId = `server:${e.serverName}`;
      const toolId = `tool:${e.serverName}:${e.toolName}`;
      nodes.set(agentId, { id: agentId, label: e.agentId, type: 'agent' });
      nodes.set(serverId, { id: serverId, label: e.serverName, type: 'server' });
      nodes.set(toolId, { id: toolId, label: e.toolName, type: 'tool' });
      edges.push({ from: agentId, to: serverId, label: 'uses', blocked: e.blocked });
      edges.push({ from: serverId, to: toolId, label: e.toolName, blocked: e.blocked });
    }

    const alerts = sessionId
      ? [...this.getAlerts(50).filter(a => a.globalSessionId === sessionId)]
      : this.getAlerts(20);

    return { nodes: [...nodes.values()], edges, alerts };
  }
}
