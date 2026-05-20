import { ProxyCallRecord } from '../types.js';
import { PolicyRule, PolicyAction, ArgPatternSpec } from '../policy/policy-types.js';

export interface AttackPatternSuggestion {
  rule: PolicyRule;
  confidence: number;
  reason: string;
  source: 'attack';
}

export function attackMinBlocks(): number {
  const n = parseInt(process.env.GUARDIAN_AI_ATTACK_MIN_BLOCKS || '3', 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** Minimum confidence before a learned pattern may be auto-applied (default requires human review). */
export function attackMinConfidence(): number {
  const n = parseFloat(process.env.GUARDIAN_AI_ATTACK_MIN_CONFIDENCE || '0.85');
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.85;
}

/** Fragments that must not become learned allow/deny patterns (feedback-loop poisoning defense). */
const POISONING_FRAGMENT_DENY = new Set([
  'pass',
  'allow',
  'allowed',
  'benign',
  'safe',
  'whitelist',
  'false positive',
  'false-positive',
  'not malicious',
  'no threat',
]);

function isPoisonedFragment(fragment: string): boolean {
  const lower = fragment.toLowerCase().trim();
  if (POISONING_FRAGMENT_DENY.has(lower)) return true;
  return [...POISONING_FRAGMENT_DENY].some((d) => lower.includes(d));
}

export function attackGroupKey(blockRule: string, toolName: string): string {
  return `${blockRule}:${toolName}`;
}

/** Extract path-like fragments from block reasons for argPattern heuristics. */
function extractPathFragments(reasons: string[]): string[] {
  const counts = new Map<string, number>();
  const pathRe = /(?:^|[\s'"`])(\/[\w./_-]+|~\/[\w./_-]+|\.\w+[\w/-]*)/g;
  for (const reason of reasons) {
    let m: RegExpExecArray | null;
    while ((m = pathRe.exec(reason)) !== null) {
      const frag = m[1].replace(/^['"`]+|['"`]+$/g, '');
      if (frag.length >= 3) {
        counts.set(frag, (counts.get(frag) || 0) + 1);
      }
    }
    for (const token of ['.ssh', '.env', '.aws', '/etc', 'credentials', 'SELECT ', 'powershell']) {
      if (reason.toLowerCase().includes(token.toLowerCase())) {
        counts.set(token, (counts.get(token) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([frag]) => frag)
    .filter((frag) => !isPoisonedFragment(frag));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferArgPatterns(reasons: string[], toolName: string): ArgPatternSpec[] {
  const frags = extractPathFragments(reasons);
  if (frags.length === 0) return [];

  const field = /read_file|write_file|list_directory|execute/.test(toolName) ? 'path' : '*';
  const patterns = frags.slice(0, 5).map((f) => {
    if (f.startsWith('/')) return escapeRegex(f);
    if (f.includes('SELECT')) return 'SELECT\\s+.*\\bFROM\\b';
    return escapeRegex(f);
  });

  return [{ field, patterns }];
}

/** Build one attack suggestion from a group of blocked records (same rule+tool). */
export function suggestFromBlockedGroup(
  blockRule: string,
  toolName: string,
  recs: ProxyCallRecord[],
): AttackPatternSuggestion | null {
  const minBlocks = attackMinBlocks();
  if (recs.length < minBlocks) return null;

  const reasons = recs.map((r) => r.blockReason || '').filter(Boolean);
  const serverName = recs[0].serverName;
  const argPatterns = inferArgPatterns(reasons, toolName);

  if (argPatterns.length > 0) {
    const slug = `${blockRule}-${toolName}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48);
    const confidence = Math.min(0.5 + recs.length * 0.08, 0.95);
    if (confidence < attackMinConfidence()) return null;
    return {
      rule: {
        name: `attack-learned-${slug}`,
        description: `Learned from ${recs.length} blocks (${blockRule} on ${toolName}@${serverName}) — pending approval`,
        action: 'block' as PolicyAction,
        argPatterns,
      },
      confidence,
      reason: `${recs.length} blocks by rule "${blockRule}" on tool "${toolName}" — common patterns: ${argPatterns[0].patterns.slice(0, 3).join(', ')}`,
      source: 'attack',
    };
  }

  const slug = `${blockRule}-${toolName}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48);
  const confidence = Math.min(0.45 + recs.length * 0.07, 0.88);
  if (confidence < attackMinConfidence()) return null;
  return {
    rule: {
      name: `attack-learned-deny-${slug}`,
      description: `Learned deny after ${recs.length} ${blockRule} blocks on ${toolName} — pending approval`,
      action: 'block' as PolicyAction,
      tools: { deny: [toolName] },
    },
    confidence,
    reason: `${recs.length} blocks by "${blockRule}" on "${toolName}" (no shared path fragment; suggesting tool deny)`,
    source: 'attack',
  };
}

/**
 * Heuristic learner: repeated blocks on the same tool/rule → argPattern or deny rule suggestions.
 */
export function learnAttackPatterns(records: ProxyCallRecord[]): AttackPatternSuggestion[] {
  const blocked = records.filter((r) => r.blocked && r.blockRule);
  if (blocked.length < attackMinBlocks()) return [];

  const groups = new Map<string, ProxyCallRecord[]>();
  for (const r of blocked) {
    const key = attackGroupKey(r.blockRule!, r.toolName);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const suggestions: AttackPatternSuggestion[] = [];

  for (const [key, recs] of groups) {
    const [blockRule, toolName] = key.split(':');
    const suggestion = suggestFromBlockedGroup(blockRule, toolName, recs);
    if (suggestion) suggestions.push(suggestion);
  }

  return suggestions;
}
