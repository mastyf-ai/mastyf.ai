/**
 * Enterprise timing side-channel mitigation — probe patterns, enumeration detection,
 * per-session rate limits, and constant-time pattern aggregation.
 */
import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import type { CallContext, PolicyDecision } from './policy-types.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import { deobfuscateRecursive } from '../utils/payload-normalizer.js';
import { stableFingerprint } from '../utils/constant-time.js';
import { envInt } from '../utils/eval-bounds.js';

/** Run every pattern; do not short-circuit on first match (reduces pattern-count timing leak). */
const TIMING_PROBE_PATTERNS: RegExp[] = [
  /\b(?:sleep|benchmark|pg_sleep|pg_sleep_for|pg_sleep_until|waitfor\s+delay|dbms_lock\.sleep|dbms_pipe\.receive_message|dbms_session\.sleep)\s*\(/i,
  /\bif\s*\(\s*(?:ascii|ord|substring|substr|mid|left|right)\s*\(/i,
  /\b(?:case\s+when|elt\s*\(|decode\s*\()\s+.*\b(?:sleep|benchmark|waitfor|pg_sleep)/i,
  /\b(?:timing|time[- ]?based)\s+(?:attack|oracle|injection|blind)/i,
  /\b(?:measure|detect|compare)\s+(?:response\s+)?time\s+(?:of|for|between)/i,
  /\b(?:valid|invalid)\s+username\b.*\b(?:timing|delay|sleep|benchmark)/i,
  /\busername\s+exists\b.*\b(?:time|delay|benchmark|sleep)/i,
  /\b(?:SLEEP|BENCHMARK)\s*\(\s*\d+/i,
  /\bWAITFOR\s+DELAY\s+'/i,
  /\b(?:select|union)\b.+\bwhere\b.+\b(?:sleep|benchmark|waitfor)/i,
  /\b'\s*or\s*'1'\s*=\s*'1\b.+\b(?:sleep|benchmark|waitfor|delay)/i,
  /\b(?:and|or)\s+\d+\s*=\s*\d+\s*--/i,
  /\bldap[_-]?search\b.+\b(?:delay|sleep|time)/i,
  /\$where\b.+\b(?:sleep|this\.constructor)/i,
  /\b(?:load_file|into\s+outfile)\b.+\b(?:sleep|benchmark)/i,
  /\bhex\s*\(\s*(?:substring|mid)\s*\(/i,
  /\b(?:response|elapsed)\s+time\s*(?:>|<|>=|<=)\s*\d+/i,
  /\buser[_-]?enumeration\b.*\b(?:timing|oracle)/i,
  /\b(?:binary|blind)\s+search\b.*\b(?:char|password|secret)/i,
];

const USERNAME_ORACLE_PATTERNS: RegExp[] = [
  /\bwhere\b\s+(?:user|username|email|login)\s*=\s*['"][^'"]{1,64}['"]/i,
  /\b(?:admin|root|administrator)\b.*\b(?:and|or)\b.*\b(?:sleep|benchmark|waitfor)/i,
  /\b(?:'|%27)\s*(?:or|and)\s*(?:'|%27)?\d+['"]?\s*=\s*['"]?\d+/i,
  /\b(?:exists|in\s*\(\s*select)\b.+\b(?:users|accounts|credentials)/i,
];

const PROBE_WINDOW_MS = 60_000;
const ENUM_WINDOW_MS = 120_000;

const MAX_TIMING_PROBES_PER_SESSION = envInt('MCP_GUARDIAN_MAX_TIMING_PROBES_PER_MIN', 8);
const MAX_ENUM_PROBES_PER_SESSION = envInt('MCP_GUARDIAN_MAX_ENUM_PROBES_PER_SESSION', 20);

const probeCounters = new LRUCache<string, { count: number; resetAt: number }>({
  max: 20_000,
  ttl: PROBE_WINDOW_MS,
});

const enumCounters = new LRUCache<string, { count: number; resetAt: number }>({
  max: 30_000,
  ttl: ENUM_WINDOW_MS,
});

export function isTimingGuardEnabled(): boolean {
  return process.env['GUARDIAN_TIMING_GUARD'] !== 'false';
}

function probeSessionKey(ctx: CallContext): string {
  const tenant = ctx.tenantId || process.env['GUARDIAN_TENANT_ID'] || 'default';
  const sub = ctx.agentIdentity?.sub || ctx.agentIdentity?.clientId || 'anon';
  return `${tenant}:${ctx.serverName}:${sub}`;
}

function buildTimingBlob(ctx: CallContext): string {
  return walkStringLeaves(ctx.arguments ?? {})
    .map((l) => deobfuscateRecursive(l.value))
    .join('\n');
}

/** Limit enumeration tracking to auth/username-oracle style probes (not benign path/query variance). */
function isEnumerationProbeCandidate(blob: string, toolName: string): boolean {
  const toolLower = toolName.toLowerCase();
  if (/(?:login|log-?in|auth|signin|sign-in|verify|register|password|credential|account)/i.test(toolLower)) {
    return true;
  }
  if (/\b(?:user(?:name)?|email|login|account|password)\b/i.test(blob)) {
    return true;
  }
  return USERNAME_ORACLE_PATTERNS.some((p) => p.test(blob));
}

/** Aggregate all pattern hits (no early exit). */
export function scanTimingProbePatterns(blob: string): { matched: boolean; ruleIds: string[] } {
  const ruleIds: string[] = [];
  if (!blob.trim()) return { matched: false, ruleIds };

  for (let i = 0; i < TIMING_PROBE_PATTERNS.length; i++) {
    if (TIMING_PROBE_PATTERNS[i].test(blob)) {
      ruleIds.push(`timing-probe-${i}`);
    }
  }
  for (let i = 0; i < USERNAME_ORACLE_PATTERNS.length; i++) {
    if (USERNAME_ORACLE_PATTERNS[i].test(blob)) {
      ruleIds.push(`username-oracle-${i}`);
    }
  }

  return { matched: ruleIds.length > 0, ruleIds };
}

/** Fingerprint for enumeration: collapse quoted strings and common usernames. */
export function enumerationFingerprint(blob: string): string {
  const normalized = blob
    .toLowerCase()
    .replace(/['"][^'"]{1,80}['"]/g, '<q>')
    .replace(/\b(?:admin|root|administrator|user\d*|test\d*|guest)\b/g, '<u>')
    .replace(/\d+/g, 'N');
  return stableFingerprint(normalized).slice(0, 16);
}

function incrementCounter(
  cache: LRUCache<string, { count: number; resetAt: number }>,
  key: string,
  windowMs: number,
): number {
  const now = Date.now();
  let counter = cache.get(key);
  if (!counter || now > counter.resetAt) {
    counter = { count: 1, resetAt: now + windowMs };
  } else {
    counter.count++;
  }
  cache.set(key, counter);
  return counter.count;
}

export function resetTimingProbeCounters(): void {
  probeCounters.clear();
  enumCounters.clear();
}

export function evaluateTimingGuard(ctx: CallContext): PolicyDecision | null {
  if (!isTimingGuardEnabled()) return null;

  const blob = buildTimingBlob(ctx);
  if (!blob.trim()) return null;

  const sessionKey = probeSessionKey(ctx);
  const scan = scanTimingProbePatterns(blob);

  if (scan.matched) {
    const probeCount = incrementCounter(probeCounters, sessionKey, PROBE_WINDOW_MS);
    if (probeCount > MAX_TIMING_PROBES_PER_SESSION) {
      return {
        action: 'block',
        rule: 'timing-probe-rate-limit',
        reason: `Timing oracle probe rate exceeded (${probeCount}/${MAX_TIMING_PROBES_PER_SESSION} per minute)`,
      };
    }
    return {
      action: 'block',
      rule: 'timing-side-channel-guard',
      reason: `Timing side-channel probe detected (${scan.ruleIds.slice(0, 3).join(', ')})`,
    };
  }

  if (isEnumerationProbeCandidate(blob, ctx.toolName)) {
    const enumKey = `${sessionKey}:${ctx.toolName}:${enumerationFingerprint(blob)}`;
    const enumCount = incrementCounter(enumCounters, enumKey, ENUM_WINDOW_MS);
    if (enumCount > MAX_ENUM_PROBES_PER_SESSION) {
      return {
        action: 'block',
        rule: 'timing-enumeration-guard',
        reason: `Timing enumeration oracle: ${enumCount} similar probes for tool '${ctx.toolName}'`,
      };
    }
  }

  return null;
}
