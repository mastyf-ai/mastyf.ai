import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { isFpWhitelisted } from '../ai/fp-whitelist.js';
import { runDetectorPlugins } from '../plugins/detector-plugin.js';
import type { SecretFinding } from '../types.js';
import { SECRET_RULES, type SecretRule } from './secret-rules.js';

// ═══════════════════════════════════════════════════════════════════
// Extended Secret Scanner — 150+ patterns with entropy gating
// ═══════════════════════════════════════════════════════════════════

type CompiledRule = {
  id: string;
  provider: string;
  severity: string;
  regex: RegExp;
  entropy?: number;
  exclusions?: RegExp[];
};

let compiledRules: CompiledRule[] | null = null;

/** Exported for tests and transparency dashboards. */
export function getSecretRuleCount(): number {
  return SECRET_RULES.length;
}

/** Compiled rules (regex pre-built at module load). */
export function getRules(): CompiledRule[] {
  if (!compiledRules) {
    compiledRules = SECRET_RULES.map((r: SecretRule) => ({
      id: r.id,
      provider: r.provider,
      severity: r.severity,
      regex: new RegExp(r.regex, r.flags),
      entropy: r.entropy,
      exclusions: r.falsePositiveExclusions?.map(e => new RegExp(e, 'i')),
    }));
  }
  return compiledRules;
}

function shannonEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const ch of str) freq[ch] = (freq[ch] ?? 0) + 1;
  return Object.values(freq).reduce((acc, count) => { const p = count / str.length; return acc - p * Math.log2(p); }, 0);
}

function redact(value: string): string {
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

/** Entropy must run on the full secret, not accidental prefix-only capture groups (e.g. AWS "AKIA"). */
function entropyCheckSubject(match: RegExpMatchArray): string {
  const full = match[0];
  const captured = match[1];
  if (!captured) return full;
  if (captured.length < 8 || captured.length < full.length * 0.5) return full;
  return captured;
}

/** Postmark tokens are UUID-shaped — require postmark context to avoid generic UUID FPs. */
function isPostmarkTokenContext(
  target: string,
  scanContext: string,
  matchIndex?: number,
): boolean {
  const haystack = `${scanContext}\n${target}`.toLowerCase();
  if (/postmark|server[_-]?token|x-postmark/i.test(haystack)) return true;
  if (matchIndex !== undefined) {
    const windowStart = Math.max(0, matchIndex - 80);
    const window = target.slice(windowStart, matchIndex + 80).toLowerCase();
    if (/postmark|pm[_-]?token|server[_-]?token/.test(window)) return true;
  }
  return false;
}

function displaySubject(match: RegExpMatchArray): string {
  const full = match[0];
  const captured = match[1];
  if (!captured || captured.length < full.length * 0.5) return full;
  return captured;
}

export function scanForSecrets(target: string, context: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seenSpans = new Set<string>();
  const pluginCtx = { location: context };
  for (const rule of getRules()) {
    // Use matchAll to find all occurrences, not just the first
    const globalRegex = new RegExp(rule.regex.source, rule.regex.flags + (rule.regex.flags.includes('g') ? '' : 'g'));
    const matches = target.matchAll(globalRegex);
    for (const match of matches) {
      const entropySubject = entropyCheckSubject(match);
      if (rule.entropy !== undefined && shannonEntropy(entropySubject) < rule.entropy) continue;
      const matchedValue = displaySubject(match);
      if (rule.id === 'postmark-api-token' && !isPostmarkTokenContext(target, context, match.index)) {
        continue;
      }
      // Test exclusions against the matched substring, not the entire target
      if (rule.exclusions?.some(fp => fp.test(matchedValue))) continue;
      if (isFpWhitelisted('secret-scan', rule.id)) continue;
      const spanKey = `${match.index}:${match.index + matchedValue.length}:${rule.id}`;
      if (seenSpans.has(spanKey)) continue;
      seenSpans.add(spanKey);
      findings.push({
        type: rule.id,
        location: context,
        severity: rule.severity as SecretFinding['severity'],
        redacted: redact(matchedValue),
        context,
        method: 'regex',
      });
    }
  }
  for (const pf of runDetectorPlugins(target, pluginCtx)) {
    const spanKey = `plugin:${pf.type}:${pf.redacted}`;
    if (seenSpans.has(spanKey)) continue;
    seenSpans.add(spanKey);
    findings.push(pf);
  }
  return findings;
}

export function scanAdjacentFiles(configDir: string): SecretFinding[] {
  const targets = [join(configDir, '.env'), join(configDir, '.env.local'), join(configDir, '.env.production'), join(configDir, 'docker-compose.yml'), join(configDir, 'docker-compose.yaml')];
  const findings: SecretFinding[] = [];
  for (const t of targets) {
    if (existsSync(t)) {
      try {
        findings.push(...scanForSecrets(readFileSync(t, 'utf8'), t));
      } catch (err) {
        // Log and continue — don't fail entire scan if one file is unreadable
        console.warn(`Failed to scan ${t}:`, err);
      }
    }
  }
  return findings;
}

export class SecretScanner {
  scan(serverConfig: { name: string; args?: string[]; env?: Record<string, string>; command?: string }): SecretFinding[] {
    const findings: SecretFinding[] = [];
    if (serverConfig.env) {
      for (const [key, value] of Object.entries(serverConfig.env)) {
        if (value && typeof value === 'string' && value.length >= 8) findings.push(...scanForSecrets(value, `env:${key}`));
      }
    }
    if (serverConfig.args) for (const arg of serverConfig.args) findings.push(...scanForSecrets(arg, 'command_args'));
    if (serverConfig.command) findings.push(...scanForSecrets(serverConfig.command, 'command'));
    const deduped = new Map<string, SecretFinding>();
    for (const f of findings) {
      deduped.set(`${f.type}:${f.location}:${f.redacted}`, f);
    }
    return [...deduped.values()];
  }
}
