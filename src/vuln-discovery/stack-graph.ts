/**
 * Agent stack graph — MCP servers, tools, upstream APIs, npm packages.
 */
import type { McpServerConfig } from '../types.js';
import { extractPackagesFromServer } from '../utils/package-extractor.js';
import { loadSbom } from './sbom.js';
import type { AgentStackGraph, AgentStackNode, AgentStackEdge, AgentStackGraphSlice } from './types.js';

export function buildAgentStackGraph(
  servers: McpServerConfig[],
  opts?: {
    toolsByServer?: Record<string, string[]>;
    observedUrls?: string[];
  },
): AgentStackGraph {
  const nodes: AgentStackNode[] = [];
  const edges: AgentStackEdge[] = [];
  const seen = new Set<string>();

  const addNode = (n: AgentStackNode): void => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };

  for (const server of servers) {
    const sid = `srv:${server.name}`;
    addNode({ id: sid, kind: 'mcp_server', name: server.name });

    const pkgs = extractPackagesFromServer(server);
    for (const pkg of pkgs) {
      const pid = `pkg:${pkg}`;
      addNode({ id: pid, kind: 'npm_package', name: pkg });
      edges.push({ from: sid, to: pid, relation: 'depends_on' });
    }

    const sbom = loadSbom(server.name);
    for (const c of (sbom?.components || []).slice(0, 50)) {
      const pid = `pkg:${c.name}@${c.version}`;
      addNode({
        id: pid,
        kind: 'npm_package',
        name: c.name,
        meta: { version: c.version },
      });
      edges.push({ from: sid, to: pid, relation: 'depends_on' });
    }

    if (server.url) {
      const uid = `api:${server.url}`;
      addNode({
        id: uid,
        kind: 'upstream_api',
        name: server.url,
        meta: { transport: server.transport || 'sse' },
      });
      edges.push({ from: sid, to: uid, relation: 'proxies' });
    }

    const tools = opts?.toolsByServer?.[server.name] || [];
    for (const tool of tools) {
      const tid = `tool:${server.name}:${tool}`;
      addNode({ id: tid, kind: 'tool', name: tool, meta: { server: server.name } });
      edges.push({ from: sid, to: tid, relation: 'hosts' });
    }
  }

  for (const url of opts?.observedUrls || []) {
    const uid = `api:${url}`;
    addNode({ id: uid, kind: 'upstream_api', name: url, meta: { source: 'observed' } });
  }

  return { nodes, edges, generatedAt: new Date().toISOString() };
}

/** Slice graph around a server or package name. */
export function sliceGraphAround(
  graph: AgentStackGraph,
  name: string,
): AgentStackGraphSlice {
  const related = new Set<string>();
  for (const n of graph.nodes) {
    if (n.name.includes(name) || n.id.includes(name)) related.add(n.id);
  }
  for (const e of graph.edges) {
    if (related.has(e.from) || related.has(e.to)) {
      related.add(e.from);
      related.add(e.to);
    }
  }
  return {
    nodes: graph.nodes.filter((n) => related.has(n.id)),
    edges: graph.edges.filter((e) => related.has(e.from) && related.has(e.to)),
  };
}
