export const SCORE_REPORT_CHECK_ID = 'mastyf-ai-score-report';
const CATEGORY_PLAIN = {
    'CVE Posture': (c) => c.score >= 90
        ? 'Dependencies look clean — no known critical vulnerabilities were found.'
        : c.score >= 60
            ? 'Some dependency vulnerabilities were found. Patch or upgrade packages to raise this score.'
            : 'Known CVEs affect this server. Update dependencies before production use.',
    Authentication: (c) => c.score >= 70
        ? 'Callers must authenticate before using tools — good for multi-user or remote setups.'
        : c.score >= 40
            ? 'Only basic API-key auth is configured. OAuth or mTLS is stronger for production.'
            : 'No authentication is configured — anyone who can reach the server can invoke tools.',
    'Transport Security': (c) => c.score >= 70
        ? 'Traffic is encrypted in transit (HTTPS or mTLS).'
        : c.score >= 40
            ? 'Uses local stdio transport (low network exposure) but no wire encryption if exposed remotely.'
            : 'Unencrypted HTTP transport — credentials and tool data can be intercepted on the network.',
    'Tool Capability': (c) => c.score >= 80
        ? 'Tool surface is mostly read-only or low risk.'
        : c.score >= 50
            ? 'Some tools can modify data or run sensitive operations — tighten policy around them.'
            : 'Many high-risk tools (exec, delete, shell) are exposed — restrict with policy and sandboxing.',
    'Supply Chain': (c) => c.score >= 90
        ? 'Package comes from a trusted publisher with no typosquat signals.'
        : 'Supply-chain signals need review — verify package name and publisher before trusting.',
    'Attack History': (c) => c.findings.some((f) => f.includes('bypassed'))
        ? 'Past attacks bypassed your defenses — review policy gaps.'
        : c.findings.some((f) => f.includes('blocked'))
            ? 'Attack attempts were blocked — defenses are working, keep monitoring.'
            : 'No attack activity observed yet in proxy telemetry.',
    'Response Hygiene': (c) => c.score >= 90
        ? 'Response DLP is active — secrets in tool output are filtered.'
        : 'Tool responses are not scanned for leaked secrets or PII — enable Response DLP.',
    'Mastyf AI Protection': (c) => c.score >= 90
        ? 'Server runs behind MCP Mastyf AI — policy, audit, and DLP apply to every call.'
        : 'Not proxied through Mastyf AI — no runtime policy enforcement or audit trail.',
};
function categoryPlainEnglish(cat) {
    return CATEGORY_PLAIN[cat.name]?.(cat) ?? cat.details;
}
function buildSummary(trustScore) {
    const parts = [
        `This server scores ${trustScore.overallScore}/100 (grade ${trustScore.grade}).`,
    ];
    const sorted = [...trustScore.categories].sort((a, b) => a.score / a.maxScore - b.score / b.maxScore);
    const weakest = sorted.slice(0, 2).filter((c) => c.score < c.maxScore * 0.7);
    if (weakest.length) {
        parts.push(`The biggest gaps are ${weakest.map((c) => c.name.toLowerCase()).join(' and ')} — fixing those will raise your score fastest.`);
    }
    else {
        parts.push('Overall posture is strong across all categories.');
    }
    const topAction = trustScore.improvementActions[0];
    if (topAction) {
        parts.push(`Top recommendation: ${topAction.action.toLowerCase()} (+~${topAction.expectedScoreIncrease} pts).`);
    }
    return parts.join(' ');
}
export function buildPublishableScoreReport(trustScore, issues = []) {
    const categories = trustScore.categories.map((cat) => ({
        name: cat.name,
        score: cat.score,
        weight: cat.weight,
        weightPercent: Math.round(cat.weight * 100),
        contributionPoints: Math.round((cat.score / cat.maxScore) * cat.weight * 100),
        findings: cat.findings,
        plainEnglish: categoryPlainEnglish(cat),
    }));
    return {
        overallScore: trustScore.overallScore,
        grade: trustScore.grade,
        summaryPlainEnglish: buildSummary(trustScore),
        categories,
        improvementActions: trustScore.improvementActions,
        issues,
    };
}
export function issuesFromSecurityScan(report, toolNames, input) {
    const issues = [];
    for (const cve of report.cves) {
        issues.push(cveToIssue(cve));
    }
    if (!report.authStatus.hasAuthentication) {
        issues.push({
            severity: 'high',
            title: 'No authentication',
            plainEnglish: 'The server accepts tool calls without verifying who is calling. In shared or remote setups, attackers could invoke file or system tools directly.',
            fixHint: 'Add OAuth 2.1, API keys, or mTLS before exposing this server beyond localhost.',
        });
    }
    else if (input.authMethod === 'api_key') {
        issues.push({
            severity: 'medium',
            title: 'Basic API key auth only',
            plainEnglish: 'Authentication relies on a static API key. Keys can leak from config files or logs.',
            fixHint: 'Upgrade to OAuth 2.1 with short-lived tokens, or mTLS for machine-to-machine access.',
        });
    }
    if (input.transport === 'http') {
        issues.push({
            severity: 'critical',
            title: 'Unencrypted HTTP transport',
            plainEnglish: 'Tool arguments and responses travel over the network in plain text. Credentials and file paths can be intercepted.',
            fixHint: 'Switch to HTTPS or route all traffic through the Mastyf AI proxy with TLS.',
        });
    }
    else if (input.transport === 'stdio') {
        issues.push({
            severity: 'info',
            title: 'Local stdio transport',
            plainEnglish: 'The server talks over local stdin/stdout — low network risk when run on the same machine, but no encryption if tunneled remotely.',
            fixHint: 'Keep stdio for local dev; use HTTPS/mTLS or Mastyf AI proxy for remote agents.',
        });
    }
    if (input.highRiskToolCount > 0) {
        issues.push({
            severity: input.highRiskToolCount >= 3 ? 'high' : 'medium',
            title: `${input.highRiskToolCount} high-risk tool${input.highRiskToolCount > 1 ? 's' : ''}`,
            plainEnglish: `Tools like ${summarizeToolNames(toolNames, 'high')} can execute commands, delete files, or change system state. A compromised agent could abuse them.`,
            fixHint: 'Block or shadow these tools in YAML policy until explicitly approved per workflow.',
        });
    }
    if (input.mediumRiskToolCount > 0) {
        issues.push({
            severity: 'low',
            title: `${input.mediumRiskToolCount} write-capable tool${input.mediumRiskToolCount > 1 ? 's' : ''}`,
            plainEnglish: `Tools such as ${summarizeToolNames(toolNames, 'medium')} can create or modify data. Review whether agents need write access.`,
            fixHint: 'Use read-only tool subsets where possible; enable cost and audit limits in policy.',
        });
    }
    for (const t of report.typoSquatRisk) {
        issues.push({
            severity: 'high',
            title: 'Possible typosquat package',
            plainEnglish: `Package name "${t.suspiciousName}" closely resembles "${t.similarityTo}" — this can be a supply-chain trick.`,
            fixHint: 'Verify the exact npm scope and publisher before installing or certifying.',
        });
    }
    for (const s of report.secretsFound.slice(0, 5)) {
        issues.push({
            severity: 'critical',
            title: 'Secret in configuration',
            plainEnglish: `A ${s.type || 'credential'} was found in server config or environment — it may be exposed to agents or logs.`,
            fixHint: 'Move secrets to a vault; rotate the exposed credential immediately.',
        });
    }
    if (report.cveLookupStatus === 'unavailable') {
        issues.push({
            severity: 'info',
            title: 'CVE database unavailable',
            plainEnglish: 'Vulnerability feeds could not be reached during the scan — score assumes best case for CVEs.',
            fixHint: 'Re-run the scan when online to confirm there are no missing CVE findings.',
        });
    }
    return issues;
}
function cveToIssue(cve) {
    const sev = cve.severity.toLowerCase();
    return {
        severity: sev === 'critical' ? 'critical' : sev === 'high' ? 'high' : sev === 'medium' ? 'medium' : 'low',
        title: `${cve.id} (${cve.severity})`,
        plainEnglish: cve.summary || `Known vulnerability ${cve.id} affects a dependency used by this server.`,
        fixHint: cve.fixedVersion
            ? `Upgrade to version ${cve.fixedVersion} or later.`
            : 'Update the affected package to the latest patched release.',
    };
}
const HIGH_RISK = /exec|shell|delete|deploy|admin|run|bash|execute|terminal|sudo|kill/i;
const MEDIUM_RISK = /write|update|create|send|post|put|patch|upload|modify/i;
function summarizeToolNames(names, kind) {
    const filtered = names.filter((n) => kind === 'high' ? HIGH_RISK.test(n) : MEDIUM_RISK.test(n));
    const sample = filtered.slice(0, 3);
    if (!sample.length)
        return kind === 'high' ? 'execute/delete tools' : 'write/update tools';
    return sample.map((n) => `"${n}"`).join(', ');
}
export function scoreReportCheckPayload(report) {
    return {
        id: SCORE_REPORT_CHECK_ID,
        type: 'score-report',
        name: 'Mastyf AI Trust Score Report',
        passed: report.overallScore >= 60,
        ...report,
    };
}
export function parseScoreReportFromChecks(checks) {
    const raw = checks.find((c) => typeof c === 'object'
        && c !== null
        && c.id === SCORE_REPORT_CHECK_ID);
    if (!raw || typeof raw.overallScore !== 'number')
        return null;
    return raw;
}
export function certificationChecksOnly(checks) {
    return checks.filter((c) => typeof c === 'object'
        && c !== null
        && c.id !== SCORE_REPORT_CHECK_ID);
}
//# sourceMappingURL=score-report.js.map