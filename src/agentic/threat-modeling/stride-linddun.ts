/**
 * C2 — Threat Modeling as Code (STRIDE / LINDDUN).
 */
import { readFileSync, existsSync } from 'fs';
import type { CapabilityEdge } from '../capability-graph/graph-builder.js';
import { CapabilityGraphBuilder } from '../capability-graph/graph-builder.js';

export type StrideCategory = 'Spoofing' | 'Tampering' | 'Repudiation' | 'InformationDisclosure' | 'DenialOfService' | 'ElevationOfPrivilege';
export type LinddunCategory = 'Linkability' | 'Identifiability' | 'NonRepudiation' | 'Detectability' | 'Disclosure' | 'Unawareness' | 'NonCompliance';

export interface DfdNode {
  id: string;
  type: 'client' | 'proxy' | 'server' | 'tool' | 'datastore';
  label: string;
}

export interface DfdEdge {
  from: string;
  to: string;
  label: string;
}

export interface ToolThreatRow {
  toolName: string;
  serverName: string;
  stride: Partial<Record<StrideCategory, string>>;
  linddun: Partial<Record<LinddunCategory, string>>;
  mitigations: string[];
}

export interface ThreatModelReport {
  title: string;
  generatedAt: string;
  nodes: DfdNode[];
  edges: DfdEdge[];
  toolThreats: ToolThreatRow[];
  summary: string;
}

function inferStride(toolName: string, description?: string): Partial<Record<StrideCategory, string>> {
  const t = `${toolName} ${description ?? ''}`.toLowerCase();
  const out: Partial<Record<StrideCategory, string>> = {};
  if (/exec|bash|shell|command|eval/.test(t)) {
    out.ElevationOfPrivilege = 'Tool may execute arbitrary commands on host';
    out.Tampering = 'Arguments could alter system state';
  }
  if (/read|fetch|get|list|search/.test(t)) {
    out.InformationDisclosure = 'Tool reads data that may include sensitive content';
  }
  if (/write|delete|update|post|upload/.test(t)) {
    out.Tampering = 'Tool mutates external state';
    out.Repudiation = 'Writes may lack sufficient audit attribution';
  }
  if (/http|curl|webhook|fetch|url/.test(t)) {
    out.Spoofing = 'Outbound requests may reach attacker-controlled endpoints';
    out.InformationDisclosure = 'Responses may leak secrets into agent context';
  }
  return out;
}

function inferLinddun(toolName: string, description?: string): Partial<Record<LinddunCategory, string>> {
  const t = `${toolName} ${description ?? ''}`.toLowerCase();
  const out: Partial<Record<LinddunCategory, string>> = {};
  if (/user|profile|email|name|identity/.test(t)) {
    out.Identifiability = 'Tool may process personally identifiable information';
    out.Linkability = 'Cross-call correlation may link user actions';
  }
  if (/log|audit|track/.test(t)) {
    out.Detectability = 'Activity may be observable beyond user expectation';
  }
  if (/read|list|search/.test(t)) {
    out.Disclosure = 'Data returned to LLM may exceed user awareness';
  }
  return out;
}

export function buildDfdFromConfig(
  servers: Array<{ name: string; tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }>,
): { nodes: DfdNode[]; edges: DfdEdge[] } {
  const nodes: DfdNode[] = [
    { id: 'client', type: 'client', label: 'AI Agent / Client' },
    { id: 'proxy', type: 'proxy', label: 'MCP Guardian Proxy' },
  ];
  const edges: DfdEdge[] = [{ from: 'client', to: 'proxy', label: 'JSON-RPC' }];

  for (const srv of servers) {
    const srvId = `server:${srv.name}`;
    nodes.push({ id: srvId, type: 'server', label: srv.name });
    edges.push({ from: 'proxy', to: srvId, label: 'tools/call' });
    for (const tool of srv.tools ?? []) {
      const toolId = `tool:${srv.name}:${tool.name}`;
      nodes.push({ id: toolId, type: 'tool', label: tool.name });
      edges.push({ from: srvId, to: toolId, label: 'invoke' });
    }
  }
  return { nodes, edges };
}

export function buildToolThreats(
  servers: Array<{ name: string; tools?: Array<{ name: string; description?: string }> }>,
  controlMitigations?: string[],
  capabilityEdges?: CapabilityEdge[],
): ToolThreatRow[] {
  const defaultMitigations = [
    'Enforce default-deny policy with explicit tool allowlists',
    'Enable prompt-injection and argument sanitization guards',
    'Require gold certification for high-risk tools',
    ...(controlMitigations ?? []),
  ];
  const rows: ToolThreatRow[] = [];
  for (const srv of servers) {
    for (const tool of srv.tools ?? []) {
      const stride = inferStride(tool.name, tool.description);
      const linddun = inferLinddun(tool.name, tool.description);
      const crossTool = (capabilityEdges ?? []).filter(
        e => e.serverName === srv.name && e.sourceTool === tool.name && e.edgeType === 'observed',
      );
      if (crossTool.length) {
        stride.Tampering = stride.Tampering ?? `Observed cross-tool chain: ${crossTool.map(e => e.targetResource).join(' → ')}`;
        stride.InformationDisclosure = stride.InformationDisclosure
          ?? 'Capability graph shows data may flow between tools in agent session';
      }
      rows.push({
        toolName: tool.name,
        serverName: srv.name,
        stride,
        linddun,
        mitigations: defaultMitigations,
      });
    }
  }
  return rows;
}

/** Map STRIDE categories to SOC2 control mitigations via ControlMapper heuristics. */
export function controlMapperMitigations(activePolicies: string[] = []): string[] {
  const mitigations: string[] = [];
  if (activePolicies.some(p => /deny|block|allowlist/i.test(p))) {
    mitigations.push('CC6.1 — Logical access: default-deny tool policy active');
  }
  if (activePolicies.some(p => /cert|gold|platinum/i.test(p))) {
    mitigations.push('CC7.1 — System monitoring: certification gate enforced');
  }
  if (activePolicies.some(p => /rate|limit|token/i.test(p))) {
    mitigations.push('CC6.6 — Rate limiting controls configured');
  }
  mitigations.push('CC6.7 — MCP Guardian audit trail captures tool-call decisions');
  mitigations.push('CC7.2 — Prompt-injection and behavioral biometrics monitoring');
  return mitigations;
}

export function generateThreatModelFromConfig(
  configPath: string,
  activePolicies: string[] = [],
  graphBuilder?: import('../capability-graph/graph-builder.js').CapabilityGraphBuilder,
): ThreatModelReport {
  const servers = loadMcpConfigServers(configPath);
  const { nodes, edges } = graphBuilder
    ? graphBuilder.buildDfdFromRegistry(servers.map(s => ({
        name: s.name,
        tools: s.tools.map(t => ({ name: t.name, description: t.description })),
      })))
    : buildDfdFromConfig(servers);
  const toolThreats = buildToolThreats(
    servers,
    controlMapperMitigations(activePolicies),
    graphBuilder ? servers.flatMap(s => graphBuilder.getEdges(s.name)) : undefined,
  );
  return {
    title: `Threat Model — ${configPath}`,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    toolThreats,
    summary: `${servers.length} server(s), ${toolThreats.length} tool threat row(s), DFD from ${graphBuilder ? 'capability graph' : 'config'}.`,
  };
}

export function generateThreatModelFromEdges(
  serverName: string,
  edges: CapabilityEdge[],
  toolMeta?: Map<string, { description?: string }>,
): ThreatModelReport {
  const tools = [...new Set(edges.map(e => e.sourceTool))];
  const servers = [{
    name: serverName,
    tools: tools.map(name => ({ name, description: toolMeta?.get(name)?.description })),
  }];
  const { nodes, edges: dfdEdges } = buildDfdFromConfig(servers);
  return {
    title: `Threat Model — ${serverName}`,
    generatedAt: new Date().toISOString(),
    nodes,
    edges: dfdEdges,
    toolThreats: buildToolThreats(servers),
    summary: `Capability graph: ${edges.length} edge(s), ${tools.length} tool(s).`,
  };
}

export function threatModelToMarkdown(report: ThreatModelReport): string {
  const lines: string[] = [
    `# ${report.title}`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `## Summary`,
    report.summary,
    '',
    '## Data Flow Diagram',
    '',
    '### Nodes',
    ...report.nodes.map(n => `- **${n.id}** (${n.type}): ${n.label}`),
    '',
    '### Edges',
    ...report.edges.map(e => `- ${e.from} → ${e.to}: ${e.label}`),
    '',
    '## STRIDE / LINDDUN per Tool',
    '',
  ];

  for (const row of report.toolThreats) {
    lines.push(`### ${row.serverName} / ${row.toolName}`);
    lines.push('');
    lines.push('**STRIDE**');
    for (const [k, v] of Object.entries(row.stride)) {
      lines.push(`- ${k}: ${v}`);
    }
    if (Object.keys(row.linddun).length) {
      lines.push('');
      lines.push('**LINDDUN**');
      for (const [k, v] of Object.entries(row.linddun)) {
        lines.push(`- ${k}: ${v}`);
      }
    }
    lines.push('');
    lines.push('**Mitigations**');
    for (const m of row.mitigations) {
      lines.push(`- ${m}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function generateThreatModelFromCapabilityGraph(
  serverName: string,
  graphBuilder: CapabilityGraphBuilder,
): ThreatModelReport {
  const edges = graphBuilder.getEdges(serverName);
  return generateThreatModelFromEdges(serverName, edges);
}

export function loadMcpConfigServers(configPath: string): Array<{ name: string; tools: Array<{ name: string; description?: string }> }> {
  if (!existsSync(configPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      mcpServers?: Record<string, { tools?: Array<{ name: string; description?: string }> }>;
    };
    return Object.entries(parsed.mcpServers ?? {}).map(([name, cfg]) => ({
      name,
      tools: cfg.tools ?? [],
    }));
  } catch {
    return [];
  }
}
