/**
 * Compiled decoded-content patterns for encoding-guard (union of command keywords + injection rule stems).
 */
import { INJECTION_RULES } from '../scanners/prompt-injection-detector.js';

/** Command/shell fragments — kept specific to reduce benign FPs (not bare "select"/"override"). */
const COMMAND_KEYWORDS = [
  'ignore',
  'disregard',
  'bypass',
  'jailbreak',
  'exec',
  'eval',
  'curl',
  'wget',
  'passwd',
  'pretend',
  'forget',
  'exfiltrate',
  'malicious',
  'unrestricted',
  'benchmark',
];

const INJECTION_STEM_RULE_IDS =
  /paraphrase|ignore-instruction|override|jailbreak|role-override|forget-training|system-prompt/i;

const MAX_STEMS = 32;
const MAX_ALT_LENGTH = 1200;

function escapeAlt(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Stems from high-severity injection rules (paraphrase / override family only). */
function injectionRuleStems(): string[] {
  const stems = new Set<string>();
  for (const rule of INJECTION_RULES) {
    if (rule.severity === 'medium') continue;
    if (!INJECTION_STEM_RULE_IDS.test(rule.id)) continue;
    const literals = rule.regex.match(/[a-z][a-z]{4,}/gi) ?? [];
    for (const raw of literals) {
      const w = raw.toLowerCase();
      if (w.length < 5 || w.length > 18) continue;
      if (/^(?:ignore|disregard|forget|prior|previous|guidance|instructions|system|prompt)$/.test(w)) {
        stems.add(w);
      }
      if (stems.size >= MAX_STEMS) break;
    }
    if (stems.size >= MAX_STEMS) break;
  }
  return [...stems];
}

function buildAlternation(): string {
  const words = [...new Set([...COMMAND_KEYWORDS, ...injectionRuleStems()])];
  let body = '';
  const used: string[] = [];
  for (const w of words) {
    const next = used.length === 0 ? escapeAlt(w) : `${body}|${escapeAlt(w)}`;
    if (next.length > MAX_ALT_LENGTH) break;
    body = next;
    used.push(w);
  }
  return body;
}

const ALT_BODY = buildAlternation();

/** Suspicious tokens after decode — keyword union + override phrasing. */
export const SUSPICIOUS_DECODED_RE = new RegExp(`\\b(?:${ALT_BODY})\\b`, 'i');

export const OVERRIDE_ATTACK_RE =
  /\boverride\b.{0,80}\b(?:all|previous|prior|safety|instruction|rules|system|filter|restriction|guidance)\b/i;
