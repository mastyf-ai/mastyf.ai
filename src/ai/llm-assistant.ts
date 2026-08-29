/**
 * LLM Assistant — Local Ollama integration for the Adaptive AI Policy Engine.
 *
 * Provides NL→YAML rule generation, anomaly explanation, threat analysis,
 * and cross-layer insight synthesis using locally-running free models.
 *
 * No API keys. No cloud costs. No data leaves the machine.
 * All calls are best-effort — graceful fallback if Ollama is unavailable.
 */
import { getLlmConfig } from '../config/llm-config.js';
import { getLlmCache } from './llm-cache.js';
import { Logger } from '../utils/logger.js';
import { getSemanticTimeoutMs } from '../utils/semantic-timeout.js';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface LlmAssistantConfig {
  model: string;
  ollamaUrl: string;
  timeoutMs: number;
  enabled: boolean;
  maxRetries: number;
  maxTokens: number;
  temperature: number;
  /** When false, use full timeoutMs (Threat Lab / batch jobs, not proxy hot path). */
  hotPath?: boolean;
}

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export function resolveOllamaBaseUrl(explicit?: string): string {
  const candidate = (explicit || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).trim();
  const withScheme = /^[a-z]+:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_OLLAMA_BASE_URL;
  }
}

function classifyHealthFailure(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err || '');
  if (/timed out|timeout|aborted/i.test(text)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN|dns/i.test(text)) return 'dns';
  if (/ECONNREFUSED|fetch failed|connect/i.test(text)) return 'connect';
  return 'unknown';
}

function probeWithHttpClient(endpoint: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const target = new URL(`${endpoint}/api/tags`);
      const requester = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = requester(
        target,
        { method: 'GET', timeout: timeoutMs, headers: { Accept: 'application/json' } },
        (res) => {
          const ok = (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300;
          res.resume();
          resolve(ok);
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
      req.end();
    } catch {
      resolve(false);
    }
  });
}

function configFromEnv(): LlmAssistantConfig {
  const llm = getLlmConfig();
  return {
    model: llm.model,
    ollamaUrl: resolveOllamaBaseUrl(llm.ollamaBaseUrl),
    timeoutMs: llm.timeoutMs,
    enabled: llm.enabled,
    maxRetries: 2,
    maxTokens: llm.maxTokens,
    temperature: llm.temperature,
    hotPath: true,
  };
}

function ollamaThinkEnabled(model: string): boolean {
  if (process.env.MASTYF_AI_LLM_OLLAMA_THINK === 'true') return true;
  if (process.env.MASTYF_AI_LLM_OLLAMA_THINK === 'false') return false;
  return !/qwen3/i.test(model);
}

export interface LlmResponse {
  text: string;
  model: string;
  tokensUsed: number;
  durationMs: number;
}

export interface LlmHealthStatus {
  ok: boolean;
  reason?: string;
  endpoint: string;
}

export class LlmAssistant {
  private config: LlmAssistantConfig;

  constructor(config?: Partial<LlmAssistantConfig>) {
    this.config = { ...configFromEnv(), ...config };
  }

  /** Check if Ollama is reachable */
  async healthCheck(): Promise<boolean> {
    const status = await this.healthCheckDetailed();
    return status.ok;
  }

  async healthCheckDetailed(): Promise<LlmHealthStatus> {
    const endpoint = this.config.ollamaUrl;
    try {
      const response = await fetch(`${endpoint}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { ok: false, reason: `http_${response.status}`, endpoint };
      }
      return { ok: true, endpoint };
    } catch (err: unknown) {
      // Some local environments report fetch ECONNREFUSED while direct HTTP probes succeed.
      const fallbackOk = await probeWithHttpClient(endpoint, 5000);
      if (fallbackOk) return { ok: true, endpoint };
      return { ok: false, reason: classifyHealthFailure(err), endpoint };
    }
  }

  /**
   * Generate completion using local Ollama model.
   * Returns null if unavailable or disabled.
   */
  async generate(systemPrompt: string, userPrompt: string): Promise<LlmResponse | null> {
    if (!this.config.enabled) return null;

    const cache = getLlmCache();
    const cacheKey = {
      model: this.config.model,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: this.config.temperature,
    };
    const cached = await cache.get(cacheKey);
    if (cached) {
      return {
        text: cached,
        model: this.config.model,
        tokensUsed: 0,
        durationMs: 0,
      };
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const budgetMs =
          this.config.hotPath === false
            ? this.config.timeoutMs
            : Math.min(this.config.timeoutMs, getSemanticTimeoutMs());
        const isAuditJson = /Respond ONLY with JSON/i.test(systemPrompt);
        const body: Record<string, unknown> = {
          model: this.config.model,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          stream: false,
          keep_alive: '30m',
          options: {
            temperature: this.config.temperature,
            num_predict: isAuditJson ? 64 : this.config.maxTokens,
            num_ctx: isAuditJson ? 1024 : 4096,
          },
        };
        if (!ollamaThinkEnabled(this.config.model)) {
          body.think = false;
        }
        const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(budgetMs),
        });

        if (!response.ok) {
          throw new Error(`Ollama returned ${response.status}`);
        }

        const data = await response.json() as {
          response?: string;
          thinking?: string;
          model?: string;
          eval_count?: number;
        };
        const durationMs = Date.now() - startTime;
        const text = (data.response || data.thinking || '').trim();

        await cache.set(cacheKey, text);

        return {
          text,
          model: data.model || this.config.model,
          tokensUsed: data.eval_count || 0,
          durationMs,
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.config.maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    Logger.debug(`[LlmAssistant] Failed after ${this.config.maxRetries + 1} attempts: ${lastError?.message}`);
    return null;
  }

  /**
   * Generate a YAML policy rule from a natural language goal.
   */
  async generatePolicyRule(goal: string, availableTools?: string[]): Promise<{
    yaml: string;
    explanation: string;
  } | null> {
    const systemPrompt = `You are an MCP (Model Context Protocol) security policy generator.
Your task is to convert a natural-language policy goal into a valid YAML policy rule for Mastyf AI.
Output ONLY a JSON object with "yaml" (the YAML rule block) and "explanation" (why this rule).

YAML format:
  - name: rule-name
    description: "rule description"
    action: block | flag | pass
    tools:
      deny: [tool_name]
    patterns:
      - 'regex_pattern'
    maxCallsPerMinute: number
    maxTokens: number
    rbac:
      scopes: [scope_name]

Available tools: ${availableTools?.join(', ') || 'unknown'}

Never wrap the JSON in markdown code blocks. Output ONLY valid JSON.`;

    const result = await this.generate(
      systemPrompt,
      `Generate a policy rule for: ${goal}`
    );

    if (!result) return null;

    try {
      const parsed = JSON.parse(result.text);
      return {
        yaml: parsed.yaml || '',
        explanation: parsed.explanation || 'Rule generated by LLM',
      };
    } catch {
      Logger.debug('[LlmAssistant] Failed to parse policy rule JSON from LLM response');
      return null;
    }
  }

  /**
   * Explain an anomaly detected by BaselineLearner in human language.
   */
  async explainAnomaly(params: {
    serverName: string;
    toolName: string;
    metric: string;
    zScore: number;
    expectedValue: number;
    actualValue: number;
    historicalSamples: number;
  }): Promise<string | null> {
    const systemPrompt = `You are an MCP security analyst. Explain anomalies concisely in one sentence.
Focus on the operational impact and what the anomaly might indicate.
Be direct and specific. No disclaimers or suggestions.`;

    const userPrompt =
      `Anomaly detected on "${params.serverName}" using tool "${params.toolName}":
- Metric: ${params.metric}
- Z-score (deviation): ${params.zScore.toFixed(2)}
- Expected value: ${params.expectedValue}
- Actual value: ${params.actualValue}
- Historical samples: ${params.historicalSamples}

Explain this anomaly:`;

    const result = await this.generate(systemPrompt, userPrompt);
    return result?.text || null;
  }

  /**
   * Analyze a CVE and suggest targeted blocking rules.
   */
  async analyzeThreat(params: {
    cveId: string;
    severity: string;
    description: string;
    affectedPackage: string;
  }): Promise<{
    impact: string;
    suggestedPatterns: string[];
    action: string;
  } | null> {
    const systemPrompt = `You are an MCP security threat analyst.
Analyze CVE impacts and suggest blocking patterns and remediation.
Output ONLY a JSON object with "impact" (one-line summary),
"suggestedPatterns" (array of regex strings), and "action" (block|flag|pass).
Never wrap the JSON in markdown code blocks. Output ONLY valid JSON.`;

    const userPrompt =
      `Analyze CVE-${params.cveId} (${params.severity}):
Description: ${params.description}
Affected package: ${params.affectedPackage}`;

    const result = await this.generate(systemPrompt, userPrompt);
    if (!result) return null;

    try {
      return JSON.parse(result.text);
    } catch {
      return null;
    }
  }

  /**
   * Synthesize cross-layer insights into an executive summary.
   */
  async synthesizeInsights(insights: Array<{
    type: string;
    severity: string;
    description: string;
  }>): Promise<string | null> {
    if (insights.length === 0) return null;

    const systemPrompt = `You are a senior SRE/security analyst.
Synthesize multiple cross-layer insights into a concise 2-3 sentence executive summary.
Focus on interconnected risks and top-priority actions. Be direct.`;

    const insightText = insights
      .map((i, idx) => `${idx + 1}. [${i.severity}] ${i.description}`)
      .join('\n');

    const result = await this.generate(
      systemPrompt,
      `Synthesize these cross-layer governance insights:\n\n${insightText}`
    );

    return result?.text || null;
  }

  /** Check if LLM is enabled and available */
  isAvailable(): boolean {
    return this.config.enabled;
  }

  getModel(): string {
    return this.config.model;
  }

  getOllamaUrl(): string {
    return this.config.ollamaUrl;
  }
}
