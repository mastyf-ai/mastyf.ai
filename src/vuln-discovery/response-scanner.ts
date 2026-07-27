/**
 * Post-response injection scanner — closes result-injection gap.
 * Scans tool *results* for injection / credential / directive payloads.
 */
import {
  createFindingId,
  fingerprintFinding,
  getFinding,
  upsertFinding,
} from './store.js';
import type { VulnFinding, VulnSeverity } from './types.js';

const RESPONSE_PATTERNS: Array<{
  id: string;
  pattern: RegExp;
  severity: VulnSeverity;
  title: string;
}> = [
  {
    id: 'result-prompt-injection',
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
    severity: 'HIGH',
    title: 'Prompt injection directive in tool result',
  },
  {
    id: 'result-system-override',
    pattern: /(?:system\s*:|\[INST\]|<\|im_start\|>\s*system)/i,
    severity: 'HIGH',
    title: 'System-role override markers in tool result',
  },
  {
    id: 'result-exfil-credential',
    pattern: /(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{20,}|-----BEGIN (?:RSA )?PRIVATE KEY-----)/,
    severity: 'CRITICAL',
    title: 'Credential material in tool result',
  },
  {
    id: 'result-html-script',
    pattern: /<script[\s>]|javascript:\s*|onerror\s*=/i,
    severity: 'MEDIUM',
    title: 'Script/HTML injection in tool result',
  },
  {
    id: 'result-data-uri-exfil',
    pattern: /data:(?:text\/html|application\/javascript);base64,/i,
    severity: 'MEDIUM',
    title: 'Suspicious data URI in tool result',
  },
];

function stringifyResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

export interface ResponseScanHit {
  patternId: string;
  title: string;
  severity: VulnSeverity;
  excerpt: string;
}

export function scanToolResultText(text: string): ResponseScanHit[] {
  const hits: ResponseScanHit[] = [];
  for (const rule of RESPONSE_PATTERNS) {
    const m = text.match(rule.pattern);
    if (m) {
      hits.push({
        patternId: rule.id,
        title: rule.title,
        severity: rule.severity,
        excerpt: text.slice(Math.max(0, (m.index || 0) - 40), (m.index || 0) + 80),
      });
    }
  }
  return hits;
}

/**
 * Scan a tools/call result and optionally persist VulnFinding records.
 * Returns hits; when createFindings=true, upserts injection-class findings.
 */
export function scanToolResponse(opts: {
  serverName: string;
  toolName: string;
  result: unknown;
  createFindings?: boolean;
}): { hits: ResponseScanHit[]; findings: VulnFinding[]; shouldBlock: boolean } {
  const text = stringifyResult(opts.result);
  const hits = scanToolResultText(text);
  const findings: VulnFinding[] = [];

  if (opts.createFindings !== false) {
    for (const hit of hits) {
      const partial = {
        class: 'injection' as const,
        severity: hit.severity,
        status: 'candidate' as const,
        title: `${hit.title} (${opts.serverName}/${opts.toolName})`,
        description: `Response scanner matched ${hit.patternId}`,
        target: {
          kind: 'tool_handler' as const,
          name: `${opts.serverName}:${opts.toolName}`,
        },
        evidence: {
          scanner: 'response-injection-scanner',
          reproSteps: [
            `Call tool ${opts.toolName} on ${opts.serverName}`,
            `Result matched pattern ${hit.patternId}`,
            `Excerpt: ${hit.excerpt.replace(/\s+/g, ' ').slice(0, 160)}`,
          ],
          payloads: [{ patternId: hit.patternId, excerpt: hit.excerpt }],
          response: text.slice(0, 2000),
        },
        exploitability: {
          preAuth: false,
          networkReachable: true,
          userInteraction: true,
        },
      };
      const fp = fingerprintFinding({
        class: partial.class,
        target: partial.target,
        title: partial.title,
        evidence: { scanner: partial.evidence.scanner, reproSteps: partial.evidence.reproSteps },
      });
      const id = createFindingId(fp);
      const existing = getFinding(id);
      findings.push(
        upsertFinding({
          ...partial,
          id,
          fingerprint: fp,
          discoveredAt: existing?.discoveredAt || new Date().toISOString(),
          status: existing?.status === 'validated' ? existing.status : 'candidate',
          validatedAt: existing?.validatedAt,
          analysisReportId: existing?.analysisReportId,
        }),
      );
    }
  }

  const shouldBlock =
    process.env.MASTYF_AI_BLOCK_ON_RESULT_INJECTION === 'true' &&
    hits.some((h) => h.severity === 'CRITICAL' || h.severity === 'HIGH');

  return { hits, findings, shouldBlock };
}
