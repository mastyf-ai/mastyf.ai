/**
 * Security gate for resources/read and prompts/get MCP responses.
 */
import { PROMPT_INJECTION_PATTERNS } from '../agentic/prompt-injection/payload-patterns.js';

function extractText(method: string, result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  const r = result as Record<string, unknown>;
  if (method === 'resources/read') {
    const contents = r.contents as Array<{ text?: string; blob?: string }> | undefined;
    if (Array.isArray(contents)) {
      return contents.map((c) => c.text ?? c.blob ?? '').join('\n');
    }
  }
  if (method === 'prompts/get') {
    const messages = r.messages as Array<{ content?: { text?: string } | string }> | undefined;
    if (Array.isArray(messages)) {
      return messages
        .map((m) => {
          if (typeof m.content === 'string') return m.content;
          return m.content?.text ?? '';
        })
        .join('\n');
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

export function gateResourceOrPromptText(
  method: string,
  result: unknown,
): { blocked: boolean; reason?: string; sanitized?: unknown } {
  if (process.env.GUARDIAN_RESOURCE_PROMPT_GUARD === 'false') {
    return { blocked: false };
  }
  const text = extractText(method, result);
  if (!text.trim()) return { blocked: false };

  let bestConfidence = 0;
  let category = 'injection';
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(text) && pattern.confidence > bestConfidence) {
        bestConfidence = pattern.confidence;
        category = pattern.category;
      }
    }
  }
  if (bestConfidence >= 0.6) {
    return {
      blocked: true,
      reason: `Resource/prompt poisoning detected: ${category} (${Math.round(bestConfidence * 100)}%)`,
    };
  }
  return { blocked: false };
}
