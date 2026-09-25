import { buildExecutiveSummary } from '../utils/dashboard-executive-summary.js';
import { buildMcpHealthReport } from './mcp-health-report.js';
import { buildAutopilotStatus } from '../utils/autopilot-status.js';
import { buildAuditHeatmap } from '../utils/audit-heatmap.js';
import { loadAllRecordsInWindow } from '../utils/cost-timeseries.js';
import { buildCostCoverage, repriceRecordsForDisplay, shouldShowCostHeadline, } from '../utils/cost-coverage.js';
import { summarizeRecords } from '../utils/db-aggregate.js';
import { readPlainEnglishReport, ensurePlainEnglishReport } from '../utils/swarm-artifacts.js';
import { parseWindowDays } from '../utils/time-buckets.js';
import { LlmAssistant } from './llm-assistant.js';
import { Logger } from '../utils/logger.js';
function isFullAnalysisLlmEnabled(useLlm) {
    if (!useLlm)
        return false;
    if (process.env.MASTYF_AI_FULL_ANALYSIS_LLM === 'false')
        return false;
    return process.env.MASTYF_AI_FULL_ANALYSIS_LLM === 'true' || true;
}
function extractSwarmBullets(report) {
    if (!report)
        return [];
    const sections = report.sections;
    if (!Array.isArray(sections))
        return [];
    const plain = sections.find((s) => /plain english/i.test(String(s.title || '')));
    return Array.isArray(plain?.bullets) ? plain.bullets.slice(0, 8) : [];
}
function computeVerdict(healthVerdict, blocked, total) {
    if (healthVerdict === 'critical')
        return 'critical';
    if (blocked > 0 && total > 0 && blocked / total > 0.15)
        return 'attention';
    return healthVerdict;
}
function buildDeterministicSummary(verdict, bullets) {
    const lead = verdict === 'healthy'
        ? 'Your MCP environment looks healthy for this period.'
        : verdict === 'attention'
            ? 'Some areas need attention — review blocks and server health below.'
            : 'Critical issues detected — review protection status and blocked traffic immediately.';
    const detail = bullets[0] || 'No proxy traffic recorded yet — route MCP clients through Mastyf AI.';
    return `${lead} ${detail}`;
}
function buildCitations(input) {
    const citations = [];
    const { summary, health, heatmapTop, autopilot, swarmBullets, costCoverage } = input;
    citations.push({
        id: 'exec:requests',
        source: 'history.db',
        text: `${summary.totalRequests} proxy calls (${summary.passRatePct}% pass rate)`,
    });
    if (summary.blockedRequests > 0) {
        citations.push({
            id: 'exec:blocked',
            source: 'history.db',
            text: `${summary.blockedRequests} blocked requests`,
        });
    }
    citations.push({
        id: 'health:verdict',
        source: 'health',
        text: `Health verdict: ${health.verdict} — ${health.headline}`,
    });
    citations.push({
        id: 'policy:mode',
        source: 'policy',
        text: `Policy mode ${health.securityPosture.policyMode}`,
    });
    if (heatmapTop) {
        citations.push({
            id: 'audit:topBlock',
            source: 'audit',
            text: `Top block: ${heatmapTop.rule} on ${heatmapTop.tool} (${heatmapTop.count}×)`,
        });
    }
    citations.push({
        id: 'autopilot:status',
        source: 'autopilot',
        text: `Autopilot ${autopilot.autopilotEnabled ? 'on' : 'off'}, scheduler ${autopilot.scheduler.running ? 'running' : 'stopped'}`,
    });
    if (shouldShowCostHeadline(costCoverage)) {
        citations.push({
            id: 'cost:measured',
            source: 'cost',
            text: `$${costCoverage.measuredUsd.toFixed(4)} measured spend (${costCoverage.coveragePct}% priced)`,
        });
    }
    swarmBullets.forEach((b, i) => {
        citations.push({ id: `swarm:${i}`, source: 'swarm', text: b });
    });
    for (const s of health.servers.slice(0, 6)) {
        citations.push({ id: `srv:${s.name}`, source: 'health', text: s.summary });
    }
    return citations;
}
function validateLlmCitations(narrative, citations) {
    const ids = citations.map((c) => c.id);
    return ids.some((id) => narrative.includes(`[${id}]`));
}
async function buildLlmNarrative(citations, sections) {
    const llm = new LlmAssistant({ hotPath: false });
    if (!llm.isAvailable())
        return null;
    const healthy = await llm.healthCheck();
    if (!healthy)
        return null;
    const corpus = citations.map((c) => `[${c.id}] ${c.text}`).join('\n');
    const sectionHints = [
        sections.protection.length ? `Protection: ${sections.protection.join(' ')}` : '',
        sections.traffic.length ? `Traffic: ${sections.traffic.join(' ')}` : '',
        sections.security.length ? `Security: ${sections.security.join(' ')}` : '',
        sections.learning.length ? `Learning: ${sections.learning.join(' ')}` : '',
    ]
        .filter(Boolean)
        .join('\n');
    try {
        const result = await llm.generate('You explain MCP Mastyf AI security and health to a non-technical operator. Use ONLY the cited facts. Write 6-10 short paragraphs in plain English covering: Protection status, Traffic, Security blocks, Learning/autopilot, and Recommended next steps. Every paragraph must include at least one citation ID in brackets like [exec:requests]. Do not invent numbers or server names.', `Facts:\n${corpus}\n\nSection notes:\n${sectionHints}\n\nWrite the full plain-English analysis:`);
        if (!result?.text?.trim())
            return null;
        if (!validateLlmCitations(result.text, citations)) {
            Logger.debug('[mastyf-ai-full-analysis] LLM narrative rejected — missing citation IDs');
            return null;
        }
        return { narrative: result.text.trim(), provider: 'ollama', model: result.model };
    }
    catch (err) {
        Logger.debug(`[mastyf-ai-full-analysis] LLM skipped: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
function formatMarkdown(report) {
    const lines = [
        '# MCP Mastyf AI — Full Analysis',
        '',
        `- **Generated:** ${report.generatedAt}`,
        `- **Window:** ${report.windowDays} days`,
        `- **Verdict:** ${report.verdict}`,
        `- **Source:** ${report.source}${report.model ? ` (${report.model})` : ''}`,
        '',
        '## Summary',
        '',
        report.plainEnglishSummary,
        '',
    ];
    if (report.narrative) {
        lines.push('## Plain-English briefing', '', report.narrative, '');
    }
    const sectionTitles = [
        ['protection', 'Protection'],
        ['traffic', 'Traffic'],
        ['security', 'Security'],
        ['learning', 'Learning & Autopilot'],
        ['nextSteps', 'Recommended next steps'],
    ];
    for (const [key, title] of sectionTitles) {
        const bullets = report.sections[key];
        if (!bullets.length)
            continue;
        lines.push(`## ${title}`, '');
        for (const b of bullets)
            lines.push(`- ${b}`);
        lines.push('');
    }
    if (report.costCoverage) {
        lines.push('## Cost note', '');
        lines.push(`- ${report.costCoverage.disclaimer}`);
        if (report.costCoverage.measuredUsd != null) {
            lines.push(`- Measured spend: $${report.costCoverage.measuredUsd.toFixed(4)}`);
        }
        lines.push('');
    }
    if (report.citations.length) {
        lines.push('## Data sources', '');
        for (const c of report.citations)
            lines.push(`- [${c.id}] (${c.source}) ${c.text}`);
    }
    lines.push('', '---', '_Generated by MCP Mastyf AI — measured aggregates with optional local LLM narrative._');
    return lines.join('\n');
}
export async function buildMastyfAiFullAnalysis(db, tenantId, opts) {
    if (!db)
        return null;
    const windowDays = parseWindowDays(opts?.windowDays ?? 7);
    const useLlm = opts?.useLlm !== false;
    let records = await loadAllRecordsInWindow(db, tenantId, windowDays);
    const repriced = await repriceRecordsForDisplay(records);
    records = repriced.records;
    const summary = await buildExecutiveSummary(db, tenantId, windowDays);
    const sum = summarizeRecords(records.length ? records : await loadAllRecordsInWindow(db, tenantId, windowDays));
    const costCoverage = buildCostCoverage(records);
    if (repriced.repricedCount > 0) {
        costCoverage.measuredUsd = sum.costUsd;
    }
    const health = await buildMcpHealthReport(db, tenantId, { windowDays, useLlm: false });
    if (!health)
        return null;
    const heatmap = buildAuditHeatmap(records);
    const heatmapTop = heatmap[0];
    const autopilot = await buildAutopilotStatus(tenantId || 'default', opts?.historyDbAttached !== false);
    const swarmReport = ensurePlainEnglishReport(tenantId) ?? readPlainEnglishReport(tenantId);
    const swarmBullets = extractSwarmBullets(swarmReport);
    const protection = [
        `Autopilot is ${autopilot.autopilotEnabled ? 'enabled' : 'disabled'}.`,
        `Protection scheduler: ${autopilot.scheduler.running ? 'running' : 'stopped'}.`,
        `Policy auto-apply: ${autopilot.protection.policyAutoApply ? 'on (review recommended)' : 'off (human approval for rule changes)'}.`,
        ...autopilot.messages.slice(0, 2),
    ];
    const traffic = [];
    if (summary.totalRequests > 0) {
        traffic.push(`${summary.totalRequests.toLocaleString()} tool calls in the last ${windowDays} days.`);
        traffic.push(`${summary.passedRequests.toLocaleString()} allowed, ${summary.blockedRequests.toLocaleString()} blocked (${summary.passRatePct}% pass rate).`);
        if (summary.avgLatencyMs > 0) {
            traffic.push(`Average latency: ${Math.round(summary.avgLatencyMs)}ms.`);
        }
    }
    else {
        traffic.push('No proxy traffic recorded — connect MCP clients through Mastyf AI.');
    }
    const security = [
        `Policy mode: ${health.securityPosture.policyMode} (${health.securityPosture.ruleSummary}).`,
    ];
    if (health.securityPosture.topBlockRules.length) {
        security.push(`Top block rules: ${health.securityPosture.topBlockRules.slice(0, 3).join('; ')}.`);
    }
    if (heatmapTop) {
        security.push(`Most common block pattern: ${heatmapTop.rule} on ${heatmapTop.tool} (${heatmapTop.count} times).`);
    }
    const learning = [
        `AI learning: ${autopilot.learning.aiEnabled ? 'enabled' : 'disabled'}.`,
        `Pending policy suggestions: ${autopilot.learning.pendingSuggestions}.`,
        `Threat research queue: ${autopilot.learning.threatResearchQueue.queued} item(s).`,
        `LLM: ${autopilot.llm.ok ? 'ready' : autopilot.llm.reason || 'needs setup'}.`,
    ];
    if (autopilot.lastDigest?.generatedAt) {
        learning.push(`Last digest: ${new Date(autopilot.lastDigest.generatedAt).toLocaleString()}.`);
    }
    const nextSteps = health.recommendations
        .sort((a, b) => a.priority - b.priority)
        .map((r) => r.action);
    if (swarmBullets.length) {
        nextSteps.push(`Security swarm: ${swarmBullets[0]}`);
    }
    const verdict = computeVerdict(health.verdict, summary.blockedRequests, summary.totalRequests);
    const measuredBullets = [
        ...protection.slice(0, 2),
        ...traffic.slice(0, 2),
        ...security.slice(0, 2),
    ];
    const citations = buildCitations({
        summary,
        health,
        heatmapTop,
        autopilot,
        swarmBullets,
        costCoverage,
    });
    const sections = { protection, traffic, security, learning, nextSteps };
    const plainEnglishSummary = buildDeterministicSummary(verdict, measuredBullets);
    const base = {
        generatedAt: new Date().toISOString(),
        windowDays,
        verdict,
        plainEnglishSummary,
        sections,
        citations,
        source: 'measured',
        costCoverage: {
            pricedCalls: costCoverage.pricedCalls,
            unpricedCalls: costCoverage.unpricedCalls,
            coveragePct: costCoverage.coveragePct,
            disclaimer: costCoverage.disclaimer,
            ...(shouldShowCostHeadline(costCoverage)
                ? { measuredUsd: costCoverage.measuredUsd }
                : {}),
        },
    };
    if (isFullAnalysisLlmEnabled(useLlm)) {
        const llm = await buildLlmNarrative(citations, sections);
        if (llm) {
            const withLlm = {
                ...base,
                source: 'llm',
                provider: llm.provider,
                model: llm.model,
                narrative: llm.narrative,
                plainEnglishSummary: llm.narrative.split('\n\n')[0]?.slice(0, 500) || plainEnglishSummary,
            };
            const full = { ...withLlm, markdown: '' };
            full.markdown = formatMarkdown(full);
            return full;
        }
    }
    const full = { ...base, markdown: '' };
    full.markdown = formatMarkdown(full);
    return full;
}
//# sourceMappingURL=mastyf-ai-full-analysis.js.map