import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { isFpWhitelisted } from '../ai/fp-whitelist.js';
import { isEntropySafeValue, minEntropyForContext } from '../policy/entropy-policy.js';
import { runDetectorPlugins } from '../plugins/detector-plugin.js';
import { SECRET_RULES } from './secret-rules.js';
let compiledRules = null;
/** Exported for tests and transparency dashboards. */
export function getSecretRuleCount() {
    return SECRET_RULES.length;
}
function compileSecretRegex(pattern, flags) {
    let regex = pattern;
    let f = flags ?? '';
    // Inline (?i:...) / (?s:...) groups are invalid alongside RegExp flags — hoist to flags.
    if (regex.includes('(?i:')) {
        regex = regex.replace(/\(\?i:/g, '(?:');
        if (!f.includes('i'))
            f = `${f}i`;
    }
    if (regex.includes('(?s:')) {
        regex = regex.replace(/\(\?s:/g, '(?:');
        if (!f.includes('s'))
            f = `${f}s`;
    }
    return new RegExp(regex, f);
}
/** Compiled rules (regex pre-built at module load). */
export function getRules() {
    if (!compiledRules) {
        compiledRules = SECRET_RULES.map((r) => ({
            id: r.id,
            provider: r.provider,
            severity: r.severity,
            regex: compileSecretRegex(r.regex, r.flags),
            entropy: r.entropy,
            exclusions: r.falsePositiveExclusions?.map(e => new RegExp(e, 'i')),
        }));
    }
    return compiledRules;
}
function shannonEntropy(str) {
    const freq = {};
    for (const ch of str)
        freq[ch] = (freq[ch] ?? 0) + 1;
    return Object.values(freq).reduce((acc, count) => { const p = count / str.length; return acc - p * Math.log2(p); }, 0);
}
function redact(value) {
    if (value.length <= 8)
        return '****';
    return value.slice(0, 4) + '****' + value.slice(-4);
}
/** Entropy must run on the full secret, not accidental prefix-only capture groups (e.g. AWS "AKIA"). */
function entropyCheckSubject(match) {
    const full = match[0];
    const captured = match[1];
    if (!captured)
        return full;
    if (captured.length < 8 || captured.length < full.length * 0.5)
        return full;
    return captured;
}
/** Postmark tokens are UUID-shaped — require postmark context to avoid generic UUID FPs. */
function isPostmarkTokenContext(target, scanContext, matchIndex) {
    const haystack = `${scanContext}\n${target}`.toLowerCase();
    if (/postmark|server[_-]?token|x-postmark/i.test(haystack))
        return true;
    if (matchIndex !== undefined) {
        const windowStart = Math.max(0, matchIndex - 80);
        const window = target.slice(windowStart, matchIndex + 80).toLowerCase();
        if (/postmark|pm[_-]?token|server[_-]?token/.test(window))
            return true;
    }
    return false;
}
function displaySubject(match) {
    const full = match[0];
    const captured = match[1];
    if (!captured || captured.length < full.length * 0.5)
        return full;
    return captured;
}
export function scanForSecrets(target, context, opts) {
    const findings = [];
    const seenSpans = new Set();
    const pluginCtx = { location: context };
    for (const rule of getRules()) {
        // Use matchAll to find all occurrences, not just the first
        const globalRegex = new RegExp(rule.regex.source, rule.regex.flags + (rule.regex.flags.includes('g') ? '' : 'g'));
        const matches = target.matchAll(globalRegex);
        for (const match of matches) {
            const entropySubject = entropyCheckSubject(match);
            const minEntropy = minEntropyForContext(opts?.toolName, opts?.fieldName) ?? rule.entropy;
            if (minEntropy !== undefined && shannonEntropy(entropySubject) < minEntropy)
                continue;
            if (rule.id === 'high-entropy-assignment'
                && isEntropySafeValue(entropySubject, opts?.toolName, opts?.fieldName)) {
                continue;
            }
            const matchedValue = displaySubject(match);
            if (rule.id === 'postmark-api-token' && !isPostmarkTokenContext(target, context, match.index)) {
                continue;
            }
            // Test exclusions against the matched substring, not the entire target
            if (rule.exclusions?.some(fp => fp.test(matchedValue)))
                continue;
            if (isFpWhitelisted('secret-scan', rule.id))
                continue;
            const spanKey = `${match.index}:${match.index + matchedValue.length}:${rule.id}`;
            if (seenSpans.has(spanKey))
                continue;
            seenSpans.add(spanKey);
            findings.push({
                type: rule.id,
                location: context,
                severity: rule.severity,
                redacted: redact(matchedValue),
                context,
                method: 'regex',
                start: match.index,
                end: match.index + matchedValue.length,
            });
        }
    }
    for (const pf of runDetectorPlugins(target, pluginCtx)) {
        const spanKey = `plugin:${pf.type}:${pf.redacted}`;
        if (seenSpans.has(spanKey))
            continue;
        seenSpans.add(spanKey);
        findings.push(pf);
    }
    return findings;
}
export function scanAdjacentFiles(configDir) {
    const targets = [join(configDir, '.env'), join(configDir, '.env.local'), join(configDir, '.env.production'), join(configDir, 'docker-compose.yml'), join(configDir, 'docker-compose.yaml')];
    const findings = [];
    for (const t of targets) {
        if (existsSync(t)) {
            try {
                findings.push(...scanForSecrets(readFileSync(t, 'utf8'), t));
            }
            catch (err) {
                // Log and continue — don't fail entire scan if one file is unreadable
                console.warn(`Failed to scan ${t}:`, err);
            }
        }
    }
    return findings;
}
export class SecretScanner {
    scan(serverConfig) {
        const findings = [];
        if (serverConfig.env) {
            for (const [key, value] of Object.entries(serverConfig.env)) {
                if (value && typeof value === 'string' && value.length >= 8)
                    findings.push(...scanForSecrets(value, `env:${key}`));
            }
        }
        if (serverConfig.args)
            for (const arg of serverConfig.args)
                findings.push(...scanForSecrets(arg, 'command_args'));
        if (serverConfig.command)
            findings.push(...scanForSecrets(serverConfig.command, 'command'));
        const deduped = new Map();
        for (const f of findings) {
            deduped.set(`${f.type}:${f.location}:${f.redacted}`, f);
        }
        return [...deduped.values()];
    }
}
//# sourceMappingURL=secret-scanner.js.map