/**
 * Compliance evidence runner — ControlMapper with live policy YAML + audit counts.
 */
import { readFileSync, existsSync } from 'fs';
import { load } from 'js-yaml';
import { ControlMapper } from './control-mapper.js';
function defaultPolicyPath() {
    return process.env.MASTYF_AI_POLICY_PATH || process.env.MASTYF_AI_POLICY_PATH || 'default-policy.yaml';
}
function extractPolicySignals(policyPath) {
    if (!existsSync(policyPath))
        return [];
    try {
        const raw = load(readFileSync(policyPath, 'utf-8'));
        const rules = raw.policy?.rules ?? [];
        return rules.map((rule) => ({
            name: rule.name ?? 'unnamed-rule',
            description: rule.description,
            action: rule.action,
            enabled: rule.enabled !== false,
        }));
    }
    catch {
        return [];
    }
}
function policyTokens(signals) {
    return signals
        .filter((signal) => signal.enabled)
        .flatMap((signal) => [signal.name, signal.description, signal.action].filter((value) => Boolean(value)));
}
async function collectAuditCounts(db, tenantId = 'default') {
    const servers = await db.getDistinctActiveServers(tenantId);
    let totalCalls = 0;
    let blockedCalls = 0;
    const byServer = [];
    const securityScans = [];
    const recentBlocked = [];
    for (const server of servers.slice(0, 20)) {
        const records = await db.getCallRecordsForServer(server, 100, tenantId);
        const serverBlocked = records.filter((r) => r.blocked === true);
        totalCalls += records.length;
        blockedCalls += serverBlocked.length;
        byServer.push({ serverName: server, totalCalls: records.length, blockedCalls: serverBlocked.length });
        for (const record of serverBlocked.slice(0, 5)) {
            recentBlocked.push({
                serverName: record.serverName,
                toolName: record.toolName,
                blockRule: record.blockRule,
                blockReason: record.blockReason,
                timestamp: record.timestamp,
                argumentSnippet: record.argumentSnippet,
            });
        }
        const scan = await db.getLatestSecurityScan(server, tenantId).catch(() => null);
        if (scan && typeof scan === 'object') {
            const report = scan;
            securityScans.push({
                serverName: server,
                score: typeof report.score === 'number' ? report.score : 0,
                cveCount: Array.isArray(report.cves) ? report.cves.length : 0,
                recommendations: Array.isArray(report.recommendations) ? report.recommendations.slice(0, 5) : [],
            });
        }
    }
    recentBlocked.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return { totalCalls, blockedCalls, servers, byServer, securityScans, recentBlocked: recentBlocked.slice(0, 12) };
}
export class ComplianceEvidenceRunner {
    db;
    store;
    mapper = new ControlMapper();
    constructor(db, store) {
        this.db = db;
        this.store = store;
    }
    async run(framework, policyPath = defaultPolicyPath()) {
        const policySignals = extractPolicySignals(policyPath);
        const activePolicies = policyTokens(policySignals);
        const auditCounts = await collectAuditCounts(this.db);
        const hasCvEs = auditCounts.securityScans.some(s => s.cveCount > 0);
        const blockedIncidents = [
            'shell_injection',
            'path_traversal',
            'prompt_injection',
            'credential_leak',
            auditCounts.blockedCalls > 0 ? 'incident' : '',
            auditCounts.blockedCalls > 0 ? 'respond' : '',
            hasCvEs ? 'vulnerability' : '',
            hasCvEs ? 'cve' : '',
            hasCvEs ? 'scan' : '',
        ].filter(Boolean);
        const posture = this.mapper.evaluate(framework, activePolicies, blockedIncidents);
        const generatedAt = new Date().toISOString();
        for (const control of posture.controls) {
            this.store?.saveComplianceControlStatus({
                framework,
                controlId: control.controlId,
                status: control.satisfied ? 'satisfied' : 'gap',
                evidenceJson: JSON.stringify({
                    satisfiedBy: control.satisfiedBy,
                    gap: control.gap,
                    auditCounts,
                    policyPath,
                    policySignals,
                    incidentSignals: blockedIncidents,
                }),
                evaluatedAt: generatedAt,
            });
        }
        return { framework, posture, policyPath, policySignals, incidentSignals: blockedIncidents, auditCounts, generatedAt };
    }
}
//# sourceMappingURL=compliance-evidence-runner.js.map