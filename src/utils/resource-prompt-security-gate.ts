/**
 * Security gate for resources/read, resources/subscribe, and prompts/get
 * MCP responses.
 *
 * A subscribe response normally carries subscription metadata rather than
 * content, so the generic JSON scan covers it; `resources/subscribe` is
 * handled as content-bearing too because servers are permitted to echo
 * resource contents in the subscribe result.
 */
import { PROMPT_INJECTION_PATTERNS } from '../agentic/prompt-injection/payload-patterns.js';
import {
  evaluateResponseDlp,
  shouldBlockResponseDlp,
} from '../policy/response-dlp.js';

interface ExtractedText {
  /** Concatenated text that was scanned. */
  text: string;
  /**
   * Rebuilds the result with every extracted segment passed through
   * `redactSegment`, preserving the surrounding structure. Returns null when
   * the result shape carries no locatable text.
   *
   * Redaction is applied per segment rather than by redistributing one joined
   * replacement: a redaction placeholder is longer than the value it replaces
   * (`987-65-4321` -> `[REDACTED:SSN]`), so offsets computed from the original
   * text do not survive the substitution.
   */
  rewrite: (redactSegment: (segment: string) => string) => unknown;
}

function extractText(method: string, result: unknown): ExtractedText {
  const plainText = (text: string): ExtractedText => ({
    text,
    rewrite: (redactSegment) => redactSegment(text),
  });

  if (result == null) return plainText('');
  if (typeof result === 'string') return plainText(result);

  const r = result as Record<string, unknown>;
  if (method === 'resources/read' || method === 'resources/subscribe') {
    const contents = r.contents as Array<{ text?: string; blob?: string }> | undefined;
    if (Array.isArray(contents)) {
      const text = contents.map((c) => c.text ?? c.blob ?? '').join('\n');
      return {
        text,
        rewrite: (redactSegment) => {
          const rebuilt = contents.map((c) => {
            const next = redactSegment(c.text ?? c.blob ?? '');
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
        rewrite: (redactSegment) => {
          const rebuilt = messages.map((m) => {
            const next = redactSegment(
              typeof m.content === 'string' ? m.content : (m.content?.text ?? ''),
            );
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
    return { text: JSON.stringify(result), rewrite: () => null };
  } catch {
    return { text: String(result), rewrite: () => null };
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
    const sanitized = rewrite((segment) => {
      const segmentDlp = evaluateResponseDlp(method, method, segment);
      return segmentDlp.redactedBody ?? segment;
    });
    if (sanitized != null) return { blocked: false, sanitized };
  }
  if (dlp.mode === 'audit' && !dlp.clean) {
    return { blocked: false };
  }
  return { blocked: false };
}
