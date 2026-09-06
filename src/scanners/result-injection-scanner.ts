/**
 * Tool Result / Response Injection Scanner
 *
 * Scans content returned by external tools/APIs/databases to prevent
 * indirect prompt injections from hijacking the agent context.
 */

export interface ResultScanResult {
  injected: boolean;
  pattern?: string;
  matchedText?: string;
  confidence: number;
  threatCategory?: string;
}

const RESULT_INJECTION_RULES: Array<{ pattern: RegExp; category: string; confidence: number }> = [
  {
    pattern: /(?:ignore|forget|disregard)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|rules|context|prompts)/i,
    category: 'instruction_override',
    confidence: 0.95,
  },
  {
    pattern: /you\s+are\s+now\s+(?:in\s+)?(?:DAN|developer|admin|god|jailbreak|unrestricted)\s*(?:mode)?/i,
    category: 'persona_hijack',
    confidence: 0.95,
  },
  {
    pattern: /\bsystem\s*:\s*(?:you\s+must|override|ignore|new\s+instructions)/i,
    category: 'system_prompt_injection',
    confidence: 0.90,
  },
  {
    pattern: /\[INST\].*?\[\/INST\]/s,
    category: 'instruction_tag_injection',
    confidence: 0.85,
  },
  {
    pattern: /<\|im_start\|>system/i,
    category: 'chatml_tag_injection',
    confidence: 0.95,
  },
  {
    pattern: /<\|(?:system|user|assistant)\|>/i,
    category: 'special_token_injection',
    confidence: 0.90,
  },
  {
    pattern: /(?:execute|run|call)\s+(?:the\s+)?(?:following|this)\s+(?:tool|function|command)\s*:/i,
    category: 'action_coercion',
    confidence: 0.85,
  },
  {
    pattern: /(?:send|post|upload|transmit|exfiltrate)\s+(?:this|the|all)\s+(?:data|content|tokens|credentials|passwords?|keys?)\s+to\s+https?:\/\//i,
    category: 'exfiltration_instruction',
    confidence: 0.92,
  },
  {
    pattern: /AI:\s*I\s+will\s+now\s+assist\s+with\s+unauthorized/i,
    category: 'fake_completion',
    confidence: 0.85,
  },
  {
    pattern: /<!--\s*#include\s+virtual=.*?-->/i,
    category: 'ssi_injection',
    confidence: 0.90,
  },
  {
    pattern: /(?:please\s+)?(?:grant|revoke|authorize|delegate)\s+(?:permanent|temporary|admin|guest|root|full|unrestricted)\s+(?:access|permission|credentials?)/i,
    category: 'privilege_escalation_request',
    confidence: 0.92,
  },
  {
    pattern: /(?:please\s+)?(?:transfer|wire|send|withdraw|pay)\s+(?:\$|usd|eur|money|funds|crypto|bitcoin)/i,
    category: 'financial_coercion',
    confidence: 0.90,
  },
  {
    pattern: /(?:please\s+)?(?:delete|drop|remove|wipe|purge|truncate)\s+(?:all\s+)?(?:users?|tables?|files?|databases?|records?|notes?|backups?)/i,
    category: 'destructive_coercion',
    confidence: 0.92,
  },
  {
    pattern: /(?:please\s+)?(?:retrieve|get|extract|fetch)\s+(?:all\s+)?(?:my\s+)?(?:saved\s+)?(?:passwords?|credentials?|addresses?|contacts?|emails?|keys?|tokens?)\s+and\s+(?:email|send|forward|post|upload|share)/i,
    category: 'data_exfiltration_request',
    confidence: 0.95,
  },
  {
    pattern: /(?:please\s+)?(?:unlock|open|disable|grant.*access\s+to.*on)\s+(?:the\s+)?(?:smart\s+lock|door|alarm|camera|security|august)/i,
    category: 'physical_access_coercion',
    confidence: 0.92,
  },
];

/**
 * Extracts plain text strings recursively from tool result objects/arrays.
 */
export function extractTextContent(result: unknown): string {
  if (result === null || result === undefined) {
    return '';
  }
  if (typeof result === 'string') {
    return result;
  }
  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }
  if (Array.isArray(result)) {
    return result.map(extractTextContent).join('\n');
  }
  if (typeof result === 'object') {
    return Object.values(result as Record<string, unknown>)
      .map(extractTextContent)
      .join('\n');
  }
  return '';
}

/**
 * Scans a tool result for prompt injection patterns.
 */
export function scanToolResult(result: unknown): ResultScanResult {
  const text = extractTextContent(result);
  if (!text || text.length < 5) {
    return { injected: false, confidence: 0 };
  }

  for (const rule of RESULT_INJECTION_RULES) {
    const match = text.match(rule.pattern);
    if (match) {
      return {
        injected: true,
        pattern: rule.pattern.source,
        matchedText: match[0].slice(0, 120),
        confidence: rule.confidence,
        threatCategory: rule.category,
      };
    }
  }

  return { injected: false, confidence: 0 };
}
