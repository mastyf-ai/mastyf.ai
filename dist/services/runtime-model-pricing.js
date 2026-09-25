/**
 * Resolves the active LLM model and per-million token rates in real time.
 * Priority: MCP message metadata → IDE client state (Cline) → env → live litellm rates.
 * Never falls back to a hardcoded default model for billing.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { PricingClient } from '../clients/pricing-client.js';
import { Logger } from '../utils/logger.js';
import { resolveModelId } from '../config/llm-config.js';
const REFRESH_MS = 2000;
export class RuntimeModelPricing {
    pricingClient = new PricingClient();
    cached = null;
    lastRefresh = 0;
    async getActivePricing() {
        if (Date.now() - this.lastRefresh < REFRESH_MS && this.cached) {
            return this.cached;
        }
        this.cached = await this.detectActivePricing();
        this.lastRefresh = Date.now();
        return this.cached;
    }
    extractModelFromMessage(msg) {
        if (!msg || typeof msg !== 'object')
            return null;
        const m = msg;
        const params = m.params;
        if (!params)
            return null;
        const meta = params._meta;
        if (typeof meta?.model === 'string' && meta.model.trim())
            return meta.model.trim();
        if (typeof meta?.modelId === 'string' && meta.modelId.trim())
            return meta.modelId.trim();
        if (typeof params.model === 'string' && params.model.trim())
            return params.model.trim();
        const args = params.arguments;
        if (args && typeof args === 'object') {
            const a = args;
            if (typeof a.model === 'string' && a.model.trim())
                return a.model.trim();
            if (typeof a.modelId === 'string' && a.modelId.trim())
                return a.modelId.trim();
        }
        return null;
    }
    /** Map agent or client name to appropriate model */
    resolveAgentModel(agentOrClientName) {
        if (!agentOrClientName)
            return null;
        const name = agentOrClientName.toLowerCase();
        if (name.includes('cursor'))
            return 'claude-3-5-sonnet';
        if (name.includes('claude'))
            return 'claude-3-5-sonnet';
        if (name.includes('dev-tool') || name.includes('dev_tool') || name.includes('ci-runner'))
            return 'gpt-4o';
        if (name.includes('analyst'))
            return 'claude-3-5-haiku';
        if (name.includes('mcp-client') || name.includes('browser'))
            return 'gemini-2.0-flash';
        if (name.includes('weather') || name.includes('search'))
            return 'gpt-4o-mini';
        if (name.includes('guard') || name.includes('mastyf') || name.includes('local'))
            return 'qwen3:8b';
        return null;
    }
    async resolveForMessage(msg, clientOrServer) {
        const fromMsg = msg ? this.extractModelFromMessage(msg) : null;
        if (fromMsg) {
            const resolved = await this.resolveModelId(fromMsg);
            if (resolved)
                return resolved;
        }
        const fromAgent = this.resolveAgentModel(clientOrServer);
        if (fromAgent) {
            const resolved = await this.resolveModelId(fromAgent);
            if (resolved)
                return resolved;
        }
        return this.getActivePricing();
    }
    async resolveModelId(modelId) {
        if (this.cached && this.modelsMatch(this.cached.modelId, modelId)) {
            return this.cached;
        }
        return this.resolveModelIdDirect(modelId);
    }
    /** Resolve rates for a model without calling getActivePricing (avoids detectActivePricing ↔ resolve recursion). */
    async resolveModelIdDirect(modelId) {
        if (process.env.MASTYF_AI_ENABLE_CLINE_PRICING === 'true') {
            const cline = this.readClinePricing();
            if (cline && this.modelsMatch(cline.modelId, modelId)) {
                return cline;
            }
        }
        const live = await this.pricingClient.getModelPricing(modelId);
        if (live) {
            return {
                modelId,
                displayName: modelId,
                inputPerM: live.input,
                outputPerM: live.output,
                source: 'litellm',
                isLive: live.isLive,
            };
        }
        // Partial matching fallback (e.g. claude-3-5-sonnet-20241022)
        for (const known of this.pricingClient.listModels()) {
            if (this.modelsMatch(known, modelId)) {
                const rates = this.pricingClient.getPricingForModel(known);
                if (rates) {
                    return {
                        modelId,
                        displayName: known,
                        inputPerM: rates.input,
                        outputPerM: rates.output,
                        source: 'litellm',
                        isLive: false,
                    };
                }
            }
        }
        return null;
    }
    computeCost(inputTokens, outputTokens, pricing) {
        if (!pricing) {
            return { costUsd: 0, source: 'unknown', priced: false };
        }
        const costUsd = (inputTokens / 1_000_000) * pricing.inputPerM +
            (outputTokens / 1_000_000) * pricing.outputPerM;
        return {
            costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
            model: pricing.modelId,
            displayName: pricing.displayName,
            source: pricing.source,
            priced: true,
        };
    }
    async computeCostForCall(inputTokens, outputTokens, msg, clientOrServer) {
        const pricing = await this.resolveForMessage(msg, clientOrServer);
        return this.computeCost(inputTokens, outputTokens, pricing);
    }
    readClineModelIdOnly() {
        if (process.env.MASTYF_AI_ENABLE_CLINE_PRICING !== 'true')
            return null;
        const statePath = join(homedir(), '.cline', 'data', 'globalState.json');
        if (!existsSync(statePath))
            return null;
        try {
            const state = JSON.parse(readFileSync(statePath, 'utf-8'));
            const id = String(state.actModeClineModelId || state.actModeAnthropicModelId || state.actModeOpenAiModelId
                || state.actModeGeminiModelId || state.actModeGroqModelId || state.actModeOpenRouterModelId || '').trim();
            return id || null;
        }
        catch {
            return null;
        }
    }
    async detectActivePricing() {
        // 1. Explicit environment model override
        const explicitEnv = process.env.MASTYF_AI_MODEL ||
            process.env.MASTYF_AI_LLM_MODEL ||
            process.env.ANTHROPIC_MODEL ||
            process.env.OPENAI_MODEL;
        if (explicitEnv?.trim()) {
            const resolved = await this.resolveModelIdDirect(explicitEnv.trim());
            if (resolved)
                return { ...resolved, source: 'env' };
        }
        // 2. Opt-in Cline pricing if enabled
        if (process.env.MASTYF_AI_ENABLE_CLINE_PRICING === 'true') {
            const cline = this.readClinePricing();
            if (cline)
                return cline;
            const clineId = this.readClineModelIdOnly();
            if (clineId) {
                const resolved = await this.resolveModelIdDirect(clineId);
                if (resolved)
                    return resolved;
            }
        }
        // 3. Centralized LLM config
        const envModel = resolveModelId();
        if (envModel?.trim() && envModel !== 'qwen3:8b') {
            const resolved = await this.resolveModelIdDirect(envModel.trim());
            if (resolved)
                return resolved;
        }
        // 4. Default Enterprise multi-model baseline: Claude 3.5 Sonnet
        const defaultModel = 'claude-3-5-sonnet';
        const resolvedDefault = await this.resolveModelIdDirect(defaultModel);
        if (resolvedDefault) {
            return {
                ...resolvedDefault,
                displayName: 'Claude 3.5 Sonnet (Fleet Baseline)',
                source: 'litellm',
            };
        }
        return null;
    }
    readClinePricing() {
        const statePath = join(homedir(), '.cline', 'data', 'globalState.json');
        if (!existsSync(statePath))
            return null;
        try {
            const state = JSON.parse(readFileSync(statePath, 'utf-8'));
            const withPrices = (modelId, displayName, info) => {
                if (info.inputPrice == null || info.outputPrice == null)
                    return null;
                return {
                    modelId,
                    displayName,
                    inputPerM: Number(info.inputPrice),
                    outputPerM: Number(info.outputPrice),
                    source: 'cline',
                    isLive: true,
                };
            };
            const clineInfo = state.actModeClineModelInfo;
            if (clineInfo) {
                const id = String(state.actModeClineModelId || clineInfo.name || 'cline');
                const row = withPrices(id, clineInfo.name || id, clineInfo);
                if (row)
                    return row;
            }
            const groqInfo = state.actModeGroqModelInfo;
            if (groqInfo) {
                const id = String(state.actModeGroqModelId || 'groq');
                const row = withPrices(id, groqInfo.description?.split('.')[0] || id, groqInfo);
                if (row)
                    return row;
            }
            const openRouterInfo = state.actModeOpenRouterModelInfo;
            if (openRouterInfo) {
                const id = String(state.actModeOpenRouterModelId || 'openrouter');
                const row = withPrices(id, id, openRouterInfo);
                if (row)
                    return row;
            }
            const modelIdOnly = String(state.actModeAnthropicModelId || state.actModeOpenAiModelId
                || state.actModeGeminiModelId || '').trim();
            if (modelIdOnly) {
                return null;
            }
        }
        catch (err) {
            Logger.debug(`[pricing] Cline state read failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return null;
    }
    modelsMatch(a, b) {
        const na = a.toLowerCase().replace(/^models\//, '');
        const nb = b.toLowerCase().replace(/^models\//, '');
        return na === nb || na.includes(nb) || nb.includes(na);
    }
}
let singleton = null;
export function getRuntimeModelPricing() {
    if (!singleton)
        singleton = new RuntimeModelPricing();
    return singleton;
}
//# sourceMappingURL=runtime-model-pricing.js.map