/**
 * Distilled fast gate — lightweight intent classifier for hot path.
 * Uses qwen3:0.6b (0.4GB, ~80ms) with category-routed prompts.
 * Uncertain 0.45-0.65 promotes to qwen3:8b; outside that range decides locally.
 */
import { LlmAssistant } from './llm-assistant.js';
import { Logger } from '../utils/logger.js';
import { withSemanticTimeout } from '../utils/semantic-timeout.js';
import type { SemanticAuditResult } from './async-semantic-audit.js';

const DEFAULT_DISTILLED_MODEL = 'qwen3:0.6b';
const LOW_THRESHOLD = parseFloat(process.env.MASTYF_AI_SEMANTIC_DISTILLED_THRESHOLD_LOW || '0.30');
const HIGH_THRESHOLD = parseFloat(process.env.MASTYF_AI_SEMANTIC_DISTILLED_THRESHOLD_HIGH || '0.75');
const PROMOTE_LOW = 0.45;
const PROMOTE_HIGH = 0.65;

export function getDistilledModel(): string {
  return process.env.MASTYF_AI_DISTILLED_MODEL || DEFAULT_DISTILLED_MODEL;
}

export function isDistilledEnabled(): boolean {
  if (process.env.MASTYF_AI_SEMANTIC_DISTILLED === 'false') return false;
  if (process.env.MASTYF_AI_DISTILLED_MODEL) return true;
  // Auto-enable when sync LLM is configured and provider is ollama
  return process.env.MASTYF_AI_SEMANTIC_DISTILLED === 'true';
}

function categoryHint(toolName: string, argsText: string): string {
  const t = toolName.toLowerCase();
  const a = argsText.toLowerCase();
  if (/admin|privilege|superuser|bypass_auth|escalate|sudo|role/i.test(t + a)) return 'privilege_escalation';
  if (/repeat|max_iterations|exhaust|infinite|while.*true/i.test(a)) return 'resource_exhaustion';
  if (/ignore.*instruction|jailbreak|dan |hypothetical.*bypass/i.test(a)) return 'jailbreak';
  if (/aws_secret|credential|api_key|oauth_token|private_key/i.test(a)) return 'credential_exfil';
  if (/graphql|query.*\{.*\}/i.test(a)) return 'graphql_injection';
  return 'general';
}

export interface DistilledResult {
  verdict: SemanticAuditResult;
  source: 'distilled' | 'promote';
  model: string;
}

export async function classifyDistilled(
  serverName: string,
  toolName: string,
  argsText: string,
): Promise<DistilledResult | null> {
  if (!isDistilledEnabled()) return null;
  const hint = categoryHint(toolName, argsText);
  const preview = argsText.slice(0, 800);
  const systemPrompt = `You are an MCP security analyst. Focus ONLY on ${hint}. Classify whether this tool call is malicious.\nRespond ONLY with JSON: {"suspicious":boolean,"confidence":0-1,"categories":string[],"reasoning":"one sentence"}`;
  const userPrompt = `Server: ${serverName}\nTool: ${toolName}\nCategory hint: ${hint}\nArguments:\n${preview}`;

  const model = getDistilledModel();
  const llm = new LlmAssistant({ model, maxTokens: 32, hotPath: true });
  if (!llm.isAvailable()) return null;

  const timeoutMs = parseInt(process.env.MASTYF_AI_DISTILLED_TIMEOUT_MS || '600', 10);
  const response = await withSemanticTimeout(
    'distilled_classifier',
    () => llm.generate(systemPrompt, userPrompt),
    null,
    timeoutMs,
  );
  if (!response?.text) return null;
  try {
    const parsed = JSON.parse(response.text) as Partial<SemanticAuditResult>;
    const verdict: SemanticAuditResult = {
      suspicious: Boolean(parsed.suspicious),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      categories: Array.isArray(parsed.categories) ? parsed.categories : [hint],
      reasoning: String(parsed.reasoning || ''),
    };
    // Uncertain band -> promote to full 8B
    if (verdict.confidence >= PROMOTE_LOW && verdict.confidence <= PROMOTE_HIGH) {
      return { verdict, source: 'promote', model };
    }
    return { verdict, source: 'distilled', model };
  } catch {
    Logger.debug('[distilled] parse error');
    return null;
  }
}

export function shouldBlockFromDistilled(verdict: SemanticAuditResult): boolean | null {
  if (verdict.confidence < LOW_THRESHOLD) return false;
  if (verdict.confidence > HIGH_THRESHOLD) return verdict.suspicious;
  if (verdict.confidence >= PROMOTE_LOW && verdict.confidence <= PROMOTE_HIGH) return null; // promote
  return verdict.suspicious && verdict.confidence >= 0.6;
}
