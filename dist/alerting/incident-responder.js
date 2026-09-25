/**
 * Incident Response Automation — webhook-driven PagerDuty, ServiceNow, Slack, Jira.
 * Enterprise Immediate Plan — Sub-Phase 1D.
 *
 * Triggers:
 *   - Critical block + anomaly score > 0.9 → PagerDuty/ServiceNow incident
 *   - Detection regression > 5% → Slack/Discord alert + Jira ticket
 *   - LLM offline > 10 min → on-call rotation
 *   - Hourly block rate spike > 3σ → SIEM event + incident
 *
 * Environment:
 *   MASTYF_AI_INCIDENT_WEBHOOK_URL         Default incident webhook (Slack/Discord)
 *   MASTYF_AI_INCIDENT_PAGERDUTY_KEY       PagerDuty Events API v2 routing key
 *   MASTYF_AI_INCIDENT_SERVICENOW_URL      ServiceNow incident table API
 *   MASTYF_AI_INCIDENT_JIRA_URL            Jira REST API URL
 *   MASTYF_AI_INCIDENT_JIRA_PROJECT        Jira project key (default: MCPG)
 *   MASTYF_AI_INCIDENT_LLM_OFFLINE_MIN     Minutes before LLM offline alert (default: 10)
 *   MASTYF_AI_INCIDENT_REGRESSION_THRESHOLD  Detection drop threshold (default: 0.05)
 *   MASTYF_AI_INCIDENT_BLOCK_SPIKE_SIGMA   Sigma multiplier for block spike (default: 3)
 */
import { StructuredLogger } from '../utils/structured-logger.js';
import { getPagerDutyRoutingKey, getSlackWebhookUrl, isAppAlertingConfigured } from './alert-env.js';
// ── Configuration ────────────────────────────────────────────────────
function getWebhookUrl() {
    return getSlackWebhookUrl();
}
function getPagerDutyKey() {
    return getPagerDutyRoutingKey();
}
export { isAppAlertingConfigured };
function getServiceNowUrl() {
    return process.env['MASTYF_AI_INCIDENT_SERVICENOW_URL'] || '';
}
function getJiraUrl() {
    return process.env['MASTYF_AI_INCIDENT_JIRA_URL'] || '';
}
// ── Slack/Discord Webhook ────────────────────────────────────────────
async function sendSlackDiscord(incident) {
    const url = getWebhookUrl();
    if (!url)
        return { ok: false, channel: 'slack', error: 'No webhook URL configured' };
    const severityEmoji = {
        critical: '🔴',
        high: '🟠',
        medium: '🟡',
        low: '🔵',
    };
    const payload = {
        text: `${severityEmoji[incident.severity]} **MCP Mastyf AI Incident: ${incident.type.replace(/_/g, ' ')}**`,
        blocks: [
            {
                type: 'header',
                text: { type: 'plain_text', text: `🚨 ${incident.summary}`, emoji: true },
            },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `*Severity:* ${incident.severity.toUpperCase()}` },
                    { type: 'mrkdwn', text: `*Type:* ${incident.type}` },
                    { type: 'mrkdwn', text: `*Time:* ${incident.timestamp}` },
                    { type: 'mrkdwn', text: `*Details:* ${JSON.stringify(incident.details).slice(0, 200)}` },
                ],
            },
        ],
    };
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return { ok: true, channel: 'slack' };
    }
    catch (err) {
        return { ok: false, channel: 'slack', error: err instanceof Error ? err.message : String(err) };
    }
}
// ── PagerDuty Events API v2 ──────────────────────────────────────────
async function createPagerDutyIncident(incident) {
    const routingKey = getPagerDutyKey();
    if (!routingKey)
        return { ok: false, channel: 'pagerduty', error: 'No PagerDuty routing key configured' };
    const payload = {
        routing_key: routingKey,
        event_action: 'trigger',
        payload: {
            summary: incident.summary,
            severity: incident.severity,
            source: 'mastyf-ai',
            component: 'proxy',
            group: 'security',
            class: incident.type,
            custom_details: incident.details,
            timestamp: incident.timestamp,
        },
    };
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch('https://events.pagerduty.com/v2/enqueue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const data = await resp.json();
        return { ok: resp.status === 202, channel: 'pagerduty', incidentId: data.dedup_key };
    }
    catch (err) {
        return { ok: false, channel: 'pagerduty', error: err instanceof Error ? err.message : String(err) };
    }
}
// ── ServiceNow Incident ───────────────────────────────────────────────
async function createServiceNowIncident(incident) {
    const url = getServiceNowUrl();
    if (!url)
        return { ok: false, channel: 'servicenow', error: 'No ServiceNow URL configured' };
    const shortDesc = incident.summary.slice(0, 160);
    const payload = {
        short_description: shortDesc,
        description: `${incident.summary}\n\nDetails: ${JSON.stringify(incident.details, null, 2)}`,
        urgency: incident.severity === 'critical' ? 1 : incident.severity === 'high' ? 2 : 3,
        impact: incident.severity === 'critical' ? 1 : incident.severity === 'high' ? 2 : 3,
        category: 'Security',
        subcategory: 'Mastyf AI',
        contact_type: 'automated',
        caller_id: 'mastyf-ai',
    };
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const data = await resp.json();
        return { ok: resp.status === 201, channel: 'servicenow', incidentId: data.result?.number || data.result?.sys_id };
    }
    catch (err) {
        return { ok: false, channel: 'servicenow', error: err instanceof Error ? err.message : String(err) };
    }
}
// ── Jira Ticket ──────────────────────────────────────────────────────
async function createJiraTicket(incident) {
    const url = getJiraUrl();
    if (!url)
        return { ok: false, channel: 'jira', error: 'No Jira URL configured' };
    const project = process.env['MASTYF_AI_INCIDENT_JIRA_PROJECT'] || 'MCPG';
    const priorityMap = { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' };
    const payload = {
        fields: {
            project: { key: project },
            summary: incident.summary.slice(0, 255),
            description: `*Incident Type:* ${incident.type}\n*Severity:* ${incident.severity}\n*Time:* ${incident.timestamp}\n\n*Details:*\n${JSON.stringify(incident.details, null, 2)}`,
            issuetype: { name: 'Bug' },
            priority: { name: priorityMap[incident.severity] },
            labels: ['mastyf-ai', 'auto-generated', incident.type],
        },
    };
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const data = await resp.json();
        return { ok: resp.status === 201, channel: 'jira', incidentId: data.key };
    }
    catch (err) {
        return { ok: false, channel: 'jira', error: err instanceof Error ? err.message : String(err) };
    }
}
// ── Orchestrator ──────────────────────────────────────────────────────
/**
 * Dispatch an incident to all configured channels.
 * Critical/high severity → PagerDuty + ServiceNow + Slack
 * Medium/low severity → Slack + Jira (optional)
 */
export async function respondToIncident(incident) {
    const results = [];
    // Always send to Slack/Discord if configured
    const slackResult = await sendSlackDiscord(incident);
    if (slackResult.ok)
        results.push(slackResult);
    if (incident.severity === 'critical' || incident.severity === 'high') {
        const [pd, sn, jira] = await Promise.all([
            createPagerDutyIncident(incident),
            createServiceNowIncident(incident),
            createJiraTicket(incident),
        ]);
        if (pd.ok)
            results.push(pd);
        if (sn.ok)
            results.push(sn);
        if (jira.ok)
            results.push(jira);
    }
    else if (incident.severity === 'medium') {
        const jira = await createJiraTicket(incident);
        if (jira.ok)
            results.push(jira);
    }
    StructuredLogger.info({
        event: 'incident_response',
        type: incident.type,
        severity: incident.severity,
        channels: results.map((r) => r.channel),
        incidentIds: results.filter((r) => r.incidentId).map((r) => r.incidentId),
    });
    return results;
}
// ── Trigger Detection ────────────────────────────────────────────────
let _llmOfflineSince = null;
let _lastBlockRate = [];
/** Trigger: critical block with high anomaly score. */
export async function checkAndRespondToCriticalBlock(blockReason, anomalyScore, toolName, serverName) {
    if (anomalyScore < 0.9)
        return;
    if (!getWebhookUrl() && !getPagerDutyKey())
        return;
    await respondToIncident({
        type: 'critical_block',
        severity: anomalyScore > 0.95 ? 'critical' : 'high',
        summary: `Critical anomaly detected on ${serverName}/${toolName}: ${blockReason}`,
        details: { blockReason, anomalyScore, toolName, serverName },
        timestamp: new Date().toISOString(),
    });
}
/** Trigger: detection regression detected by red-team analysis. */
export async function checkAndRespondToRegression(currentRecall, baselineRecall, delta) {
    const threshold = parseFloat(process.env['MASTYF_AI_INCIDENT_REGRESSION_THRESHOLD'] || '0.05');
    if (delta <= threshold)
        return;
    await respondToIncident({
        type: 'regression',
        severity: delta > 0.1 ? 'critical' : 'high',
        summary: `Detection regression detected: recall dropped ${(delta * 100).toFixed(1)}% (${(baselineRecall * 100).toFixed(1)}% → ${(currentRecall * 100).toFixed(1)}%)`,
        details: { currentRecall, baselineRecall, delta },
        timestamp: new Date().toISOString(),
    });
}
/** Track LLM health and alert if offline > threshold minutes. */
export function trackLlmHealth(online) {
    void import('../utils/observability-gauges.js').then(({ setLlmProbeOnline }) => {
        setLlmProbeOnline(online);
    }).catch(() => undefined);
    if (online) {
        _llmOfflineSince = null;
        return;
    }
    const now = Date.now();
    if (!_llmOfflineSince) {
        _llmOfflineSince = now;
        return;
    }
    const offlineMinutes = (now - _llmOfflineSince) / 60000;
    const threshold = parseInt(process.env['MASTYF_AI_INCIDENT_LLM_OFFLINE_MIN'] || '10', 10);
    if (offlineMinutes >= threshold) {
        void respondToIncident({
            type: 'llm_offline',
            severity: offlineMinutes > 30 ? 'critical' : 'medium',
            summary: `LLM (Ollama) has been offline for ${Math.floor(offlineMinutes)} minutes — threat discovery paused`,
            details: { offlineMinutes: Math.floor(offlineMinutes), since: new Date(_llmOfflineSince).toISOString() },
            timestamp: new Date().toISOString(),
        });
        _llmOfflineSince = null; // Reset to avoid repeated alerts
    }
}
/** Track block rate spikes. */
export function trackBlockSpike(blocked) {
    const now = Date.now();
    _lastBlockRate.push({ count: 1, timestamp: now });
    // Keep last 60 minutes
    _lastBlockRate = _lastBlockRate.filter((b) => now - b.timestamp < 3600000);
    if (_lastBlockRate.length < 30)
        return; // Need enough data
    const mean = _lastBlockRate.length / 60; // blocks per minute
    const variance = _lastBlockRate.reduce((sum, b) => sum + Math.pow(1 - mean, 2), 0) / _lastBlockRate.length;
    const stddev = Math.sqrt(variance);
    const sigma = parseFloat(process.env['MASTYF_AI_INCIDENT_BLOCK_SPIKE_SIGMA'] || '3');
    const recentBlocks = _lastBlockRate.filter((b) => now - b.timestamp < 60000).length;
    if (recentBlocks > mean + sigma * stddev) {
        void respondToIncident({
            type: 'block_spike',
            severity: recentBlocks > mean + 4 * stddev ? 'critical' : 'medium',
            summary: `Block rate spike detected: ${recentBlocks} blocks/min (mean=${mean.toFixed(1)}, σ=${stddev.toFixed(2)})`,
            details: { recentBlocks, mean: mean.toFixed(2), stddev: stddev.toFixed(2), sigma },
            timestamp: new Date().toISOString(),
        });
    }
}
/** Reset state for tests. */
export function resetIncidentResponderForTests() {
    _llmOfflineSince = null;
    _lastBlockRate = [];
}
//# sourceMappingURL=incident-responder.js.map