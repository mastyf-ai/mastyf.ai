/**
 * Effect-gating for novel/runtime findings.
 * Soft denials (Access denied, isError) are not exploit success.
 */

const SOFT_DENY_RE =
  /access\s+denied|path\s+outside\s+allowed|outside\s+the\s+allowed|not\s+in\s+.*allowed|permission\s+denied|eacces|enoent|forbidden|unauthorized|invalid\s+path|path\s+traversal\s+blocked|blocked\s+by\s+mastyf|is\s+not\s+allowed/i;

const EXPLOIT_CONTENT_RE =
  /(?:root:[x*]:0:0:|-----BEGIN (?:RSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{20,}|ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|<script[\s>]|javascript:\s*)/i;

export type ExploitEffectKind =
  | 'crash'
  | 'secret_or_injection'
  | 'sensitive_content'
  | 'none'
  | 'soft_deny';

export function stringifyResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/** MCP tool result marked as error (isError / is_error). */
export function resultLooksLikeMcpError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  if (r.isError === true || r.is_error === true) return true;
  return false;
}

export function isSoftDenyText(text: string): boolean {
  return SOFT_DENY_RE.test(text);
}

/** Response is mostly an echo of the request args (common benign FP). */
export function isArgsEchoOnly(
  args: Record<string, unknown>,
  responseText: string,
): boolean {
  if (!responseText || responseText.length < 2) return true;
  try {
    const argsJson = JSON.stringify(args);
    if (responseText === argsJson) return true;
    // {"content":[{"type":"text","text":"<argsJson>"}]}
    if (responseText.includes(argsJson) && responseText.length < argsJson.length + 80) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function classifyExploitEffect(opts: {
  args?: Record<string, unknown>;
  responseText?: string;
  result?: unknown;
  crashed?: boolean;
  upstreamError?: string;
}): { kind: ExploitEffectKind; reason: string } {
  if (opts.crashed) {
    return { kind: 'crash', reason: 'upstream crashed' };
  }
  if (opts.result != null && resultLooksLikeMcpError(opts.result)) {
    const text = stringifyResult(opts.result);
    if (isSoftDenyText(text) || isSoftDenyText(opts.upstreamError || '')) {
      return { kind: 'soft_deny', reason: 'mcp isError soft deny' };
    }
    return { kind: 'soft_deny', reason: 'mcp isError without exploit content' };
  }

  const text = (opts.responseText || stringifyResult(opts.result) || opts.upstreamError || '').trim();
  if (!text) {
    return { kind: 'none', reason: 'empty response' };
  }
  if (isSoftDenyText(text)) {
    return { kind: 'soft_deny', reason: 'soft-deny response text' };
  }
  // Echo of request args is not an exploit (even if args contain injection strings)
  if (opts.args && isArgsEchoOnly(opts.args, text)) {
    return { kind: 'none', reason: 'response echoes args only' };
  }
  if (EXPLOIT_CONTENT_RE.test(text)) {
    return { kind: 'secret_or_injection', reason: 'secret or injection markers in result' };
  }
  // Substantial non-deny body after malicious args — weak positive (path read success etc.)
  if (text.length >= 120 && !/"path"\s*:\s*"\.\.\//.test(text)) {
    return { kind: 'sensitive_content', reason: 'substantial non-deny result body' };
  }
  return { kind: 'none', reason: 'no exploit effect proven' };
}

export function hasProvenExploitEffect(opts: {
  args?: Record<string, unknown>;
  responseText?: string;
  result?: unknown;
  crashed?: boolean;
  upstreamError?: string;
}): boolean {
  const k = classifyExploitEffect(opts).kind;
  return k === 'crash' || k === 'secret_or_injection' || k === 'sensitive_content';
}

export function isMaliciousArgs(args: Record<string, unknown>): boolean {
  const s = JSON.stringify(args);
  return (
    /\.\.\//.test(s)
    || /ignore\s+all\s+previous/i.test(s)
    || /DROP\s+TABLE/i.test(s)
    || /169\.254\.169\.254/.test(s)
    || /__proto__/.test(s)
    || s.length > 5000
  );
}

/** Evidence markers used by validate / NoiseRejecter. */
export const EXPLOIT_EFFECT_RULE = 'exploit-effect';
export const EXPLOIT_EFFECT_DECISION = 'allow-exploit';
