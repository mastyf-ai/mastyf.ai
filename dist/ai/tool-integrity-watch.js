/**
 * Tool Integrity Watch — baseline tools/list per server; diff + classify rug-pull / schema drift.
 */
import { createHash } from 'crypto';
const EXFIL_SCHEMA_HINTS = /\b(?:webhook|upload|post|send|exfil|http|url|callback|transmit|forward)\b/i;
function isSensitiveToolName(name) {
    return /run|exec|bash|eval|delete|write|upload|post|send|command/i.test(name);
}
function hashText(text) {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
export function snapshotFromProbeTool(tool) {
    const desc = tool.description || '';
    const schema = tool.inputSchema ? JSON.stringify(tool.inputSchema) : '';
    return {
        name: tool.name,
        descriptionHash: hashText(desc),
        schemaHash: hashText(schema),
    };
}
export function buildServerBaseline(serverName, tools) {
    const snapshots = tools.map(snapshotFromProbeTool);
    const toolNames = snapshots.map((t) => t.name).sort();
    const fingerprint = hashText(toolNames.join('|') + snapshots.map((t) => t.schemaHash).join('|'));
    return {
        serverName,
        fingerprint,
        tools: snapshots,
        toolNames,
        capturedAt: new Date().toISOString(),
    };
}
function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++)
        dp[i][0] = i;
    for (let j = 0; j <= n; j++)
        dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] =
                a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}
function classifyNewTool(name, schema) {
    if (isSensitiveToolName(name))
        return 'critical';
    if (schema && EXFIL_SCHEMA_HINTS.test(name))
        return 'critical';
    return 'suspicious';
}
function classifySchemaChange(prev, cur) {
    if (prev.schemaHash !== cur.schemaHash && isSensitiveToolName(cur.name))
        return 'critical';
    if (prev.schemaHash !== cur.schemaHash)
        return 'suspicious';
    return 'benign';
}
export function diffToolBaselines(previous, current) {
    if (!previous) {
        return {
            serverName: current.serverName,
            changed: false,
            diffs: [],
            currentFingerprint: current.fingerprint,
            quarantineRecommended: false,
        };
    }
    const diffs = [];
    const prevByName = new Map(previous.tools.map((t) => [t.name, t]));
    const curByName = new Map(current.tools.map((t) => [t.name, t]));
    for (const name of current.toolNames) {
        if (!prevByName.has(name)) {
            const cur = curByName.get(name);
            const severity = classifyNewTool(name, cur);
            diffs.push({
                kind: 'added',
                toolName: name,
                current: cur,
                severity,
                reason: severity === 'critical'
                    ? 'New high-risk tool added mid-session'
                    : 'New tool added since baseline',
            });
        }
    }
    for (const name of previous.toolNames) {
        if (!curByName.has(name)) {
            diffs.push({
                kind: 'removed',
                toolName: name,
                previous: prevByName.get(name),
                severity: 'suspicious',
                reason: 'Tool removed since baseline — possible rug-pull prep',
            });
        }
    }
    for (const name of current.toolNames) {
        const prev = prevByName.get(name);
        const cur = curByName.get(name);
        if (!prev || !cur)
            continue;
        if (prev.descriptionHash !== cur.descriptionHash || prev.schemaHash !== cur.schemaHash) {
            const severity = classifySchemaChange(prev, cur);
            diffs.push({
                kind: 'modified',
                toolName: name,
                previous: prev,
                current: cur,
                severity,
                reason: severity === 'critical'
                    ? 'Schema drift on sensitive tool'
                    : 'Tool description or schema changed',
            });
        }
    }
    for (const added of diffs.filter((d) => d.kind === 'added')) {
        for (const existing of previous.toolNames) {
            if (existing === added.toolName)
                continue;
            const dist = levenshtein(existing.toLowerCase(), added.toolName.toLowerCase());
            if (dist > 0 && dist <= 2) {
                diffs.push({
                    kind: 'typosquat',
                    toolName: added.toolName,
                    severity: 'critical',
                    reason: `Typosquat near existing tool '${existing}' (edit distance ${dist})`,
                });
            }
        }
    }
    const quarantineRecommended = diffs.some((d) => d.severity === 'critical');
    return {
        serverName: current.serverName,
        changed: previous.fingerprint !== current.fingerprint,
        diffs,
        previousFingerprint: previous.fingerprint,
        currentFingerprint: current.fingerprint,
        quarantineRecommended,
    };
}
export function summarizeToolIntegrityReports(reports) {
    return {
        serversChecked: reports.length,
        serversChanged: reports.filter((r) => r.changed).length,
        criticalCount: reports.reduce((n, r) => n + r.diffs.filter((d) => d.severity === 'critical').length, 0),
        quarantineServers: reports.filter((r) => r.quarantineRecommended).map((r) => r.serverName),
    };
}
//# sourceMappingURL=tool-integrity-watch.js.map