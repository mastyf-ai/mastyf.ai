import { diffToolBaselines } from './tool-integrity-watch.js';
const SENSITIVE_ARG_PATTERNS = [
    { path: 'path', pattern: /\.\./, severity: 'critical' },
    { path: 'url', pattern: /https?:\/\//, severity: 'suspicious' },
    { path: 'command', pattern: /curl|wget|bash|sudo/i, severity: 'critical' },
    { path: 'content', pattern: /password|secret|token|api[_-]?key/i, severity: 'suspicious' },
];
function isSensitiveToolName(name) {
    return /run|exec|bash|eval|delete|write|upload|post|send|command|read|file/i.test(name);
}
function inferArgPaths(tool) {
    const paths = [];
    if (isSensitiveToolName(tool.name)) {
        paths.push({ path: 'input', severity: 'suspicious' });
    }
    for (const hint of SENSITIVE_ARG_PATTERNS) {
        if (hint.path === 'input' && isSensitiveToolName(tool.name)) {
            paths.push({ path: hint.path, severity: hint.severity });
        }
    }
    return paths;
}
export function buildSupplyChainGraph(baselines, agentCallCounts, integrityReports) {
    const nodes = [];
    const edges = [];
    const blastRadius = [];
    for (const baseline of baselines) {
        const serverId = `server:${baseline.serverName}`;
        nodes.push({
            id: serverId,
            kind: 'server',
            label: baseline.serverName,
            metadata: { toolCount: baseline.toolNames.length, fingerprint: baseline.fingerprint },
        });
        for (const tool of baseline.tools) {
            const toolId = `tool:${baseline.serverName}:${tool.name}`;
            const severity = isSensitiveToolName(tool.name) ? 'critical' : 'benign';
            nodes.push({
                id: toolId,
                kind: 'tool',
                label: tool.name,
                severity,
                metadata: { schemaHash: tool.schemaHash },
            });
            edges.push({ from: serverId, to: toolId, kind: 'hosts' });
            for (const argPath of inferArgPaths(tool)) {
                const argId = `arg:${baseline.serverName}:${tool.name}:${argPath.path}`;
                nodes.push({
                    id: argId,
                    kind: 'arg_path',
                    label: `${tool.name}.${argPath.path}`,
                    severity: argPath.severity,
                });
                edges.push({ from: toolId, to: argId, kind: 'exposes' });
            }
            const agentKey = `${baseline.serverName}:${tool.name}`;
            const calls = agentCallCounts?.[agentKey] ?? 0;
            if (calls > 0) {
                const agentId = `agent:${baseline.serverName}`;
                if (!nodes.find((n) => n.id === agentId)) {
                    nodes.push({ id: agentId, kind: 'agent', label: `agents@${baseline.serverName}` });
                    edges.push({ from: agentId, to: toolId, kind: 'calls' });
                }
                blastRadius.push({
                    toolId,
                    downstreamAgents: calls,
                    risk: severity === 'critical' ? 'high' : 'medium',
                });
            }
        }
    }
    for (const report of integrityReports || []) {
        if (!report.changed)
            continue;
        for (const diff of report.diffs) {
            const toolId = `tool:${report.serverName}:${diff.toolName}`;
            edges.push({
                from: toolId,
                to: `drift:${report.serverName}:${diff.kind}:${diff.toolName}`,
                kind: 'drift',
            });
            if (!nodes.find((n) => n.id === `drift:${report.serverName}:${diff.kind}:${diff.toolName}`)) {
                nodes.push({
                    id: `drift:${report.serverName}:${diff.kind}:${diff.toolName}`,
                    kind: 'arg_path',
                    label: `${diff.kind}: ${diff.toolName}`,
                    severity: diff.severity,
                    metadata: { reason: diff.reason },
                });
            }
        }
    }
    return {
        nodes,
        edges,
        blastRadius: blastRadius.sort((a, b) => b.downstreamAgents - a.downstreamAgents).slice(0, 20),
        generatedAt: new Date().toISOString(),
    };
}
export function buildSupplyChainFromIntegrityDiff(previous, current) {
    const report = diffToolBaselines(previous, current);
    return buildSupplyChainGraph([current], undefined, [report]);
}
//# sourceMappingURL=supply-chain-graph.js.map