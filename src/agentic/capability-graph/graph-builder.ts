/**
 * Capability graph builder — edges from tools/list + observed tool calls.
 */
import { IndustryStandardStore } from '../../database/industry-standard-store.js';

export interface CapabilityEdge {
  serverName: string;
  sourceTool: string;
  targetResource?: string;
  edgeType: 'declared' | 'observed' | 'resource';
  metadata?: Record<string, unknown>;
}

export interface ToolListEntry {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class CapabilityGraphBuilder {
  private edges = new Map<string, CapabilityEdge[]>();

  constructor(private readonly store?: IndustryStandardStore) {}

  buildFromToolList(serverName: string, tools: ToolListEntry[]): CapabilityEdge[] {
    const built: CapabilityEdge[] = [];
    for (const tool of tools) {
      const props = (tool.inputSchema?.properties as Record<string, unknown> | undefined) ?? {};
      const resourceKeys = Object.keys(props).filter(k => /uri|path|url|resource/i.test(k));
      if (resourceKeys.length) {
        for (const key of resourceKeys) {
          const edge: CapabilityEdge = {
            serverName,
            sourceTool: tool.name,
            targetResource: key,
            edgeType: 'resource',
            metadata: { from: 'tools/list' },
          };
          built.push(edge);
          this.persist(edge);
        }
      } else {
        const edge: CapabilityEdge = {
          serverName,
          sourceTool: tool.name,
          edgeType: 'declared',
          metadata: { description: tool.description },
        };
        built.push(edge);
        this.persist(edge);
      }
    }
    this.edges.set(serverName, [...(this.edges.get(serverName) ?? []), ...built]);
    return built;
  }

  recordObservedCall(serverName: string, fromTool: string, toTool: string, metadata?: Record<string, unknown>): CapabilityEdge {
    const edge: CapabilityEdge = {
      serverName,
      sourceTool: fromTool,
      targetResource: toTool,
      edgeType: 'observed',
      metadata,
    };
    this.persist(edge);
    const list = this.edges.get(serverName) ?? [];
    list.push(edge);
    this.edges.set(serverName, list.slice(-500));
    return edge;
  }

  getEdges(serverName: string): CapabilityEdge[] {
    return this.edges.get(serverName) ?? [];
  }

  private persist(edge: CapabilityEdge): void {
    this.store?.saveCapabilityEdge({
      serverName: edge.serverName,
      sourceTool: edge.sourceTool,
      targetResource: edge.targetResource,
      edgeType: edge.edgeType,
      metadataJson: edge.metadata ? JSON.stringify(edge.metadata) : undefined,
    });
  }

  /** Emit DFD nodes/edges from tools/list registry + capability edges (C2). */
  buildDfdFromRegistry(
    servers: Array<{ name: string; tools?: ToolListEntry[] }>,
  ): { nodes: Array<{ id: string; type: 'client' | 'proxy' | 'server' | 'tool' | 'datastore'; label: string }>; edges: Array<{ from: string; to: string; label: string }> } {
    const nodes: Array<{ id: string; type: 'client' | 'proxy' | 'server' | 'tool' | 'datastore'; label: string }> = [
      { id: 'client', type: 'client', label: 'AI Agent / Client' },
      { id: 'proxy', type: 'proxy', label: 'MCP Guardian Proxy' },
    ];
    const edges: Array<{ from: string; to: string; label: string }> = [
      { from: 'client', to: 'proxy', label: 'JSON-RPC' },
    ];

    for (const srv of servers) {
      const tools = srv.tools ?? [];
      if (tools.length) {
        this.buildFromToolList(srv.name, tools);
      }
      const srvId = `server:${srv.name}`;
      nodes.push({ id: srvId, type: 'server', label: srv.name });
      edges.push({ from: 'proxy', to: srvId, label: 'tools/call' });

      for (const tool of tools) {
        const toolId = `tool:${srv.name}:${tool.name}`;
        nodes.push({ id: toolId, type: 'tool', label: tool.name });
        edges.push({ from: srvId, to: toolId, label: 'invoke' });

        const capEdges = this.getEdges(srv.name).filter(e => e.sourceTool === tool.name);
        for (const ce of capEdges) {
          if (ce.targetResource && ce.edgeType === 'resource') {
            const dsId = `datastore:${srv.name}:${ce.targetResource}`;
            if (!nodes.some(n => n.id === dsId)) {
              nodes.push({ id: dsId, type: 'datastore', label: ce.targetResource });
            }
            edges.push({ from: toolId, to: dsId, label: ce.edgeType });
          }
        }
      }
    }
    return { nodes, edges };
  }
}
