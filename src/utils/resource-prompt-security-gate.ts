/**
 * Security gate for resources/read and prompts/get MCP responses.
 */
import { PROMPT_INJECTION_PATTERNS } from '../agentic/prompt-injection/payload-patterns.js';
import {
  evaluateResponseDlp,
  getResponseDlpMode,
  shouldBlockResponseDlp,
} from '../policy/response-dlp.js';

interface ExtractedText {
  /** Concatenated text that was scanned. */
  text: string;
  /**
   * Applies `replacement` in place of the scanned text, preserving the
   * surrounding result structure. Returns null when nothing needs replacing.
   */
  rewrite: (replacement: string) => unknown;
}

function extractText(method: string, result: unknown): ExtractedText {
  const noRewrite = (text: string): ExtractedText => ({
    text,
    rewrite: () => null,
  });

  if (result == null) return noRewrite('');
  if (typeof result === 'string') return noRewrite(result);

  const r = result as Record<string, unknown>;
  if (method === 'resources/read') {
    const contents = r.contents as Array<{ text?: string; blob?: string }> | undefined;
    if (Array.isArray(contents)) {
      const text = contents.map((c) => c.text ?? c.blob ?? '').join('\n');
      return {
        text,
        rewrite: (replacement) => {
          let cursor = 0;
          const rebuilt = contents.map((c) => {
            const original = c.text ?? c.blob ?? '';
            const next = replacement.slice(cursor, cursor + original.length);
            cursor += original.length + 1;
            return c.text != null ? { ...c, text: next } : { ...c, blob: next };
          });
          return { ...r, contents: rebuilt };
        },
      };
    }
  }
  if (method === 'prompts/get') {
    const messages = r.messages as Array<{ content?: { text?: string } | string }> | undefined;
    if (Array.isArray(messages)) {
      const text = messages
        .map((m) => (typeof m.content === 'string' ? m.content : (m.content?.text ?? '')))
        .join('\n');
      return {
        text,
        rewrite: (replacement) => {
          let cursor = 0;
          const rebuilt = messages.map((m) => {
            const original = typeof m.content === 'string' ? m.content : (m.content?.text ?? '');
            const next = replacement.slice(cursor, cursor + original.length);
            cursor += original.length + 1;
            return typeof m.content === 'string'
              ? { ...m, content: next }
              : { ...m, content: { ...(m.content ?? {}), text: next } };
          });
          return { ...r, messages: rebuilt };
        },
      };
    }
  }
  try {
    return noRewrite(JSON.stringify(result));
  } catch {
    return noRewrite(String(result));
  }
}

export function gateResourceOrPromptText(
  method: string,
  result: unknown,
): { blocked: boolean; reason?: string; sanitized?: unknown } {
  if (process.env.MASTYF_AI_RESOURCE_PROMPT_GUARD === 'false') {
    return { blocked: false };
  }
  const { text, rewrite } = extractText(method, result);
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

  // Resource and prompt payloads are a response path like any other: run them
  // through the same DLP that PolicyEngine.evaluateResponse and the streaming
  // inspector use, so PII and secrets cannot leave a server unredacted.
  const dlp = evaluateResponseDlp(method, method, text);
  if (shouldBlockResponseDlp(dlp)) {
    return {
      blocked: true,
      reason: `Sensitive data leak prevented: ${dlp.findings[0]?.message ?? 'response DLP'}`,
    };
  }
  if (dlp.mode === 'redact' && dlp.redactedBody != null) {
    const sanitized = rewrite(dlp.redactedBody);
    if (sanitized != null) return { blocked: false, sanitized };
  }
  if (dlp.mode === 'audit' && !dlp.clean) {
    return { blocked: false };
  }
  return { blocked: false };
}
