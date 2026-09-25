import { buildSessionChainGraph, detectChainPatterns, } from '../policy/session-chain-detector.js';
function classifyRole(node) {
    if (node.exfilHint)
        return 'exfil';
    if (node.encodeHint)
        return 'transform';
    if (node.sensitiveRead)
        return 'read';
    if (/run|exec|bash|eval|python|node/i.test(node.toolName))
        return 'execute';
    return 'unknown';
}
function inferIntentFromPatterns(patterns, nodes) {
    if (!patterns.length) {
        const roles = nodes.map((n) => n.role).filter((r) => r !== 'unknown');
        if (roles.length === 0)
            return 'single-tool activity';
        return `sequential ${roles.join(' → ')}`;
    }
    const best = patterns.sort((a, b) => b.confidence - a.confidence)[0];
    const toolPath = best.nodes.map((i) => nodes[i]?.toolName).filter(Boolean).join(' → ');
    return `${best.pattern.replace(/-/g, ' ')} (${Math.round(best.confidence * 100)}%): ${toolPath}`;
}
function killChainStagesFromPatterns(patterns) {
    if (!patterns.length)
        return [];
    const best = patterns.sort((a, b) => b.confidence - a.confidence)[0];
    switch (best.pattern) {
        case 'read-encode-exfil':
            return ['reconnaissance', 'collection', 'transform', 'exfiltration'];
        case 'read-then-exfil':
            return ['collection', 'exfiltration'];
        case 'encode-then-exfil':
            return ['transform', 'exfiltration'];
        case 'multi-step-staging':
            return ['staging', 'collection', 'action'];
        default:
            return ['multi-step-chain'];
    }
}
export function buildAgentIntentGraph(sessionKey, flow) {
    const chainGraph = buildSessionChainGraph(sessionKey, flow);
    const patterns = detectChainPatterns(chainGraph);
    const nodes = chainGraph.nodes.map((n, index) => ({
        index,
        toolName: n.toolName,
        role: classifyRole(n),
        at: n.at,
        sensitiveRead: n.sensitiveRead,
        encodeHint: n.encodeHint,
        exfilHint: n.exfilHint,
        citationId: `flow:${index}`,
    }));
    const edges = chainGraph.edges.map((e) => ({
        from: e.from,
        to: e.to,
        kind: e.kind,
    }));
    const inferredIntent = inferIntentFromPatterns(patterns, nodes);
    const killChainStages = killChainStagesFromPatterns(patterns);
    return {
        sessionKey,
        nodes,
        edges,
        patterns,
        inferredIntent,
        killChainStages,
    };
}
export function buildKillChainNarrative(graph, anchorTool, citations) {
    const parts = [];
    if (graph.killChainStages.length) {
        parts.push(`Kill-chain stages: ${graph.killChainStages.join(' → ')}.`);
    }
    parts.push(`Inferred intent: ${graph.inferredIntent}.`);
    if (anchorTool) {
        parts.push(`Trigger tool: ${anchorTool}.`);
    }
    if (graph.nodes.length >= 2) {
        const path = graph.nodes.map((n) => `${n.toolName}[${n.role}]`).join(' → ');
        parts.push(`Session path: ${path}.`);
    }
    const cite = citations?.[0]?.id;
    if (cite)
        parts.push(`[${cite}]`);
    return parts.join(' ');
}
//# sourceMappingURL=agent-intent-graph.js.map