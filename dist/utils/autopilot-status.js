/**
 * Aggregated Autopilot status for CLI and dashboard API.
 */
import { existsSync, readFileSync } from 'fs';
import { isAiLearningEnabled } from './ai-enabled.js';
import { readAutopilotConfig, readLastDigestMeta } from './autopilot-config.js';
import { isAutopilotMode } from './autopilot-profile.js';
import { readRecentLearningEvents } from './learning-events.js';
import { getSchedulerStatus } from './threat-discovery-scheduler.js';
import { getThreatResearchQueueStatus, threatResearchAutoEnabled } from '../ai/threat-research-pipeline.js';
import { resolveAiPendingSuggestionsPath } from '../ai/ai-paths.js';
import { DEFAULT_TENANT_ID, validateTenantId } from '../tenant/resolve-tenant.js';
import { getLicenseClient } from '../license/license-client.js';
import { isCiLicenseBypass } from '../license/feature-tiers.js';
import { isCiTokenCached } from '../license/ci-token.js';
import { resolveOllamaBaseUrl } from '../ai/llm-assistant.js';
function countPendingSuggestions(tenantId) {
    const path = resolveAiPendingSuggestionsPath(tenantId);
    if (!existsSync(path))
        return 0;
    try {
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        return Array.isArray(data.suggestions) ? data.suggestions.length : 0;
    }
    catch {
        return 0;
    }
}
export async function buildAutopilotStatus(tenantId = DEFAULT_TENANT_ID, historyDbAttached = false) {
    const tid = validateTenantId(tenantId);
    const config = readAutopilotConfig();
    const lc = getLicenseClient();
    const bypass = isCiLicenseBypass() || isCiTokenCached();
    const messages = [];
    let llmOk = false;
    let llmReason;
    try {
        const { ensureThreatLabLlmReady } = await import('../ai/threat-lab.js');
        const ready = await ensureThreatLabLlmReady();
        llmOk = ready.ok;
        llmReason = ready.reason;
    }
    catch {
        llmReason = 'LLM check unavailable';
    }
    if (!historyDbAttached) {
        messages.push('No proxy history DB — route MCP traffic through Mastyf AI.');
    }
    if (!llmOk) {
        const endpoint = resolveOllamaBaseUrl(process.env.OLLAMA_BASE_URL);
        messages.push(`LLM unavailable: ${llmReason || 'install Ollama and pull qwen3:8b'} (endpoint: ${endpoint})`);
    }
    if (process.env.MASTYF_AI_AI_AUTO_APPLY === 'true') {
        messages.push('Policy auto-apply is ON — Autopilot recommends human review (false).');
    }
    else {
        messages.push('Protection is automatic; policy changes need your approval.');
    }
    return {
        timestamp: new Date().toISOString(),
        autopilotEnabled: isAutopilotMode(),
        config,
        license: {
            pro: bypass || lc.hasFeature('dashboard') || lc.hasFeature('swarm'),
            swarm: bypass || lc.hasFeature('swarm'),
            ai: bypass || lc.hasFeature('ai'),
            dashboard: bypass || lc.hasFeature('dashboard'),
        },
        protection: {
            historyDbAttached,
            policyAutoApply: process.env.MASTYF_AI_AI_AUTO_APPLY === 'true',
        },
        learning: {
            aiEnabled: isAiLearningEnabled(),
            pendingSuggestions: countPendingSuggestions(tid),
            threatResearchEnabled: threatResearchAutoEnabled(),
            threatResearchQueue: getThreatResearchQueueStatus(),
        },
        scheduler: getSchedulerStatus(tid),
        lastDigest: readLastDigestMeta(),
        recentEvents: readRecentLearningEvents(tid, 20),
        llm: { ok: llmOk, reason: llmReason },
        messages,
    };
}
//# sourceMappingURL=autopilot-status.js.map