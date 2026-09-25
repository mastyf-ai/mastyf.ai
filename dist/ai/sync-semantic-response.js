/**
 * Synchronous semantic gate on tool responses (before forwarding to client).
 * Enable: MASTYF_AI_SEMANTIC_SYNC_RESPONSE=true
 * Optional LLM: MASTYF_AI_SEMANTIC_SYNC_RESPONSE_LLM=true (adds latency)
 */
import { LlmAssistant } from './llm-assistant.js';
import { scoreLocalSemanticText } from './local-semantic-classifier.js';
import { isLocalSemanticEnabledForTenant, isSyncSemanticLlmEnabledForTenant, isSyncSemanticResponseEnabledForTenant, } from '../tenant/tenant-semantic-config.js';
import { isSemanticLlmConfigured, reportSemanticDegradation, } from '../utils/semantic-layer.js';
import { withSemanticTimeout } from '../utils/semantic-timeout.js';
import { Logger } from '../utils/logger.js';
const MIN_CONFIDENCE = parseFloat(process.env['MASTYF_AI_SEMANTIC_SYNC_MIN_CONFIDENCE'] || process.env['MASTYF_AI_SEMANTIC_MIN_CONFIDENCE'] || '0.6');
export function isSyncSemanticResponseEnabled(tenantId) {
    return isSyncSemanticResponseEnabledForTenant(tenantId);
}
export function isSyncSemanticLlmEnabled(tenantId) {
    return isSyncSemanticLlmEnabledForTenant(tenantId);
}
export async function evaluateSyncSemanticResponse(input) {
    const noop = {
        suspicious: false,
        confidence: 0,
        categories: ['none'],
        reasoning: 'Sync semantic disabled',
    };
    const tenantId = input.tenantId;
    if (!isSyncSemanticResponseEnabled(tenantId)) {
        return { block: false, result: noop, source: 'none' };
    }
    if (isLocalSemanticEnabledForTenant(tenantId)) {
        const local = scoreLocalSemanticText(input.responseText, {
            serverName: input.serverName,
            toolName: input.toolName,
        });
        const result = {
            suspicious: local.suspicious,
            confidence: local.risk,
            categories: local.categories,
            reasoning: local.reasoning,
        };
        if (local.suspicious && local.risk >= MIN_CONFIDENCE) {
            return { block: true, result, source: 'local' };
        }
    }
    if (!isSyncSemanticLlmEnabled(tenantId) || !isSemanticLlmConfigured()) {
        return {
            block: false,
            result: noop,
            source: isLocalSemanticEnabledForTenant(tenantId) ? 'local' : 'none',
        };
    }
    const llm = new LlmAssistant();
    if (!llm.isAvailable()) {
        reportSemanticDegradation('sync_response_llm_unavailable', {
            serverName: input.serverName,
            toolName: input.toolName,
        });
        return { block: false, result: noop, source: 'none' };
    }
    const preview = input.responseText.slice(0, 4000);
    const systemPrompt = `You are an MCP security analyst. Classify whether a tool RESPONSE is malicious or leaks secrets.
Respond ONLY with JSON: {"suspicious":boolean,"confidence":0-1,"categories":string[],"reasoning":"one sentence"}`;
    const userPrompt = `Server: ${input.serverName}\nTool: ${input.toolName}\nResponse preview:\n${preview}`;
    const response = await withSemanticTimeout('sync_semantic_response', () => llm.generate(systemPrompt, userPrompt), null, parseInt(process.env['MASTYF_AI_SEMANTIC_SYNC_TIMEOUT_MS'] || '3000', 10));
    if (!response?.text) {
        return { block: false, result: noop, source: 'none' };
    }
    try {
        const parsed = JSON.parse(response.text);
        const result = {
            suspicious: Boolean(parsed.suspicious),
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
            categories: Array.isArray(parsed.categories) ? parsed.categories : [],
            reasoning: String(parsed.reasoning || ''),
        };
        const block = result.suspicious && result.confidence >= MIN_CONFIDENCE;
        if (block) {
            Logger.warn(`[sync-semantic] Blocked response ${input.toolName}@${input.serverName}: ${result.reasoning}`);
        }
        return { block, result, source: 'llm' };
    }
    catch {
        return { block: false, result: noop, source: 'none' };
    }
}
//# sourceMappingURL=sync-semantic-response.js.map