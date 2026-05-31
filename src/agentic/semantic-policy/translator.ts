/**
 * C5 — Semantic Policy Translator: bidirectional NL ↔ YAML with simulation gate.
 */
import { readFileSync, existsSync } from 'fs';
import { dump, load } from 'js-yaml';
import type { PolicyConfig, PolicyRule } from '../../policy/policy-types.js';
import { LlmAssistant } from '../../ai/llm-assistant.js';
import { generatePolicyCopilotSuggestion, type PolicyCopilotSuggestion } from '../../ai/policy-copilot.js';
import { Logger } from '../../utils/logger.js';

export type PolicyExplainSection = {
  title: string;
  summary: string;
};

export type PolicyNaturalLanguageSummary = {
  overview: string;
  sections: PolicyExplainSection[];
  ruleCount: number;
  mode: string;
  source: 'llm' | 'heuristic';
};

export type NaturalLanguageToPolicyResult = PolicyCopilotSuggestion & {
  source: 'semantic-translator';
};

function defaultPolicyPath(): string {
  return process.env.GUARDIAN_POLICY_PATH || process.env.MCP_GUARDIAN_POLICY_PATH || 'default-policy.yaml';
}

export function loadPolicyConfig(path?: string): PolicyConfig | null {
  const p = path || defaultPolicyPath();
  if (!existsSync(p)) return null;
  try {
    return load(readFileSync(p, 'utf-8')) as PolicyConfig;
  } catch {
    return null;
  }
}

function explainRuleHeuristic(rule: PolicyRule): string {
  const parts: string[] = [];
  parts.push(`Rule "${rule.name}" (${rule.action ?? 'block'}).`);
  if (rule.description) parts.push(rule.description);
  if (rule.tools?.deny?.length) parts.push(`Denies tools: ${rule.tools.deny.join(', ')}.`);
  if (rule.tools?.allow?.length) parts.push(`Allows only: ${rule.tools.allow.join(', ')}.`);
  if (rule.patterns?.length) parts.push(`Blocks argument patterns matching ${rule.patterns.length} regex(es).`);
  if (rule.maxCallsPerMinute) parts.push(`Rate limit: ${rule.maxCallsPerMinute} calls/minute.`);
  if (rule.maxTokens) parts.push(`Token budget: ${rule.maxTokens} tokens.`);
  if (rule.rbac?.scopes?.length) parts.push(`Requires scopes: ${rule.rbac.scopes.join(', ')}.`);
  return parts.join(' ');
}

function explainPolicyHeuristic(config: PolicyConfig): PolicyNaturalLanguageSummary {
  const policy = config.policy;
  const rules = policy?.rules ?? [];
  const sections: PolicyExplainSection[] = [];

  sections.push({
    title: 'Default behavior',
    summary: `Policy mode is "${policy?.mode ?? 'block'}". Default action for unmatched calls: ${policy?.default_action ?? 'block'}.`,
  });

  if (policy?.require_certification) {
    sections.push({
      title: 'Certification requirement',
      summary: `MCP servers must meet ${policy.require_certification} certification level or higher.`,
    });
  }

  if (policy?.default_sandbox_tier) {
    sections.push({
      title: 'Sandbox tier',
      summary: `Default sandbox tier for new agents: ${policy.default_sandbox_tier}.`,
    });
  }

  for (const rule of rules.slice(0, 25)) {
    sections.push({ title: rule.name, summary: explainRuleHeuristic(rule) });
  }
  if (rules.length > 25) {
    sections.push({
      title: 'Additional rules',
      summary: `${rules.length - 25} more rules not shown in summary.`,
    });
  }

  return {
    overview: `This policy contains ${rules.length} rule(s) in ${policy?.mode ?? 'block'} mode.`,
    sections,
    ruleCount: rules.length,
    mode: policy?.mode ?? 'block',
    source: 'heuristic',
  };
}

/** YAML / PolicyConfig → plain-English summary for compliance stakeholders. */
export async function policyToNaturalLanguage(
  input: PolicyConfig | string,
  opts?: { policyPath?: string; useLlm?: boolean },
): Promise<PolicyNaturalLanguageSummary> {
  let config: PolicyConfig | null;
  if (typeof input === 'string') {
    config = load(input) as PolicyConfig;
  } else {
    config = input;
  }
  if (!config?.policy) {
    return {
      overview: 'Invalid or empty policy configuration.',
      sections: [],
      ruleCount: 0,
      mode: 'unknown',
      source: 'heuristic',
    };
  }

  const heuristic = explainPolicyHeuristic(config);
  const useLlm = opts?.useLlm !== false;
  if (!useLlm) return heuristic;

  const llm = new LlmAssistant();
  const yamlText = typeof input === 'string' ? input : dump(config);
  const systemPrompt = `You are a compliance officer explaining MCP security policies in plain English.
Summarize the policy for non-technical stakeholders. Output ONLY JSON:
{"overview":"one paragraph","sections":[{"title":"section name","summary":"plain English"}]}
Cover: default mode, denied tools, sensitive patterns, rate limits, certification, and RBAC if present.
Never use markdown code blocks.`;

  const result = await llm.generate(systemPrompt, `Explain this MCP Guardian policy:\n\n${yamlText.slice(0, 12000)}`);
  if (!result?.text) return heuristic;

  try {
    const parsed = JSON.parse(result.text) as {
      overview?: string;
      sections?: PolicyExplainSection[];
    };
    return {
      overview: parsed.overview || heuristic.overview,
      sections: parsed.sections?.length ? parsed.sections : heuristic.sections,
      ruleCount: heuristic.ruleCount,
      mode: heuristic.mode,
      source: 'llm',
    };
  } catch {
    Logger.debug('[SemanticPolicy] LLM explain parse failed — using heuristic');
    return heuristic;
  }
}

/** Natural language goal → draft YAML rule with mandatory corpus replay. */
export async function naturalLanguageToPolicy(
  goal: string,
  opts?: {
    availableTools?: string[];
    policyPath?: string;
    tenantId?: string;
    skipReplay?: boolean;
  },
): Promise<NaturalLanguageToPolicyResult | null> {
  const suggestion = await generatePolicyCopilotSuggestion(goal, opts);
  if (!suggestion) return null;
  return { ...suggestion, source: 'semantic-translator' };
}

/** Explain a single rule or full policy file path. */
export async function explainPolicyFile(policyPath?: string): Promise<PolicyNaturalLanguageSummary> {
  const config = loadPolicyConfig(policyPath);
  if (!config) {
    return {
      overview: `Policy file not found: ${policyPath || defaultPolicyPath()}`,
      sections: [],
      ruleCount: 0,
      mode: 'unknown',
      source: 'heuristic',
    };
  }
  return policyToNaturalLanguage(config);
}
