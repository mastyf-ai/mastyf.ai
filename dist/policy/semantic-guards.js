import { deobfuscateRecursive, detectShellInBase64Blobs } from '../utils/payload-normalizer.js';
import { preprocessForInjectionMatch } from '../utils/injection-preprocess.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import { evaluatePathGuard, extractPathArgumentValues } from './path-guard.js';
import { evaluateUrlGuard, extractHttpUrlsFromLeaves } from './url-guard.js';
const REPO_ARG_FIELDS = new Set(['repo', 'repository', 'owner']);
const SQL_SENSITIVE_TABLES = 'accounts|customers|users|credentials|secrets|payments|transactions|admin_users|passwords';
const SQL_EXFIL_PATTERNS = [
    new RegExp(`\\bselect\\b.+\\bfrom\\b.+\\b(?:${SQL_SENSITIVE_TABLES})\\b`, 'i'),
    new RegExp(`\\bselect\\s+\\*\\s+from\\b.+\\b(?:${SQL_SENSITIVE_TABLES})\\b`, 'i'),
    /\b(?:drop|truncate)\s+(?:table|database)\b/i,
    /\bdelete\s+from\b/i,
    /\bunion\b.+\bselect\b/i,
    /\/\*+\s*union\b/i,
    /\bor\s+['"]?1['"]?\s*=\s*['"]?1['"]?\b/i,
    /\bor\s+1\s*=\s*1\b/i,
    /\b'\s*or\s*'1'\s*=\s*'1/i,
    /\badmin'\s*--/i,
    /\b'\s*or\s*'?\d+'?\s*=\s*'?\d+'?\s*--/i,
    /\bor\s+'[^']+'\s*=\s*'[^']+'/i,
    /\/\*+\s*union\b/i,
    /\bcase\s+when\b.+\b(?:password|secret|token|credential)/i,
    /\bload_file\s*\(/i,
    /\bsleep\s*\(/i,
    /\bbenchmark\s*\(/i,
    /\binto\s+outfile\b/i,
    /\bextractvalue\s*\(/i,
    /\bupdatexml\s*\(/i,
    /"\$where"\s*:/i,
    /"\$gt"\s*:/i,
    /"\$regex"\s*:/i,
    /"\$ne"\s*:/i,
    /\$where\b/i,
    /\$gt\b/i,
    /\$regex\b/i,
    /\$ne\b/i,
    /__schema\b/i,
    /\bintrospection\b/i,
    /\*\)\s*\(\s*uid\s*=/i,
    /\*\)\s*\(/,
    /admin\)\s*\(&/i,
    /\|\s*\(\s*\|/i,
    /\)\s*\(\s*\|/i,
    /\)\s*\)\s*\(/,
];
const BASE64_SHELL_PATTERNS = [
    /\bbase64\s+(?:-d|--decode)\b.+\|\s*(?:sh|bash|zsh)\b/i,
    /\|\s*base64\s+(?:-d|--decode)\b.+\|\s*(?:sh|bash|zsh)\b/i,
    /\becho\s+['"]?[A-Za-z0-9+/]{12,}={0,2}['"]?\s*\|\s*base64\s+(?:-d|--decode)\b/i,
    /\bbase64\s+(?:-d|--decode)\b\s*<<<?\s*['"]?[A-Za-z0-9+/]{8,}/i,
];
const POWERSHELL_PATTERNS = [
    /\bpowershell(?:\.exe)?\b/i,
    /\bpwsh\b/i,
    /-enc(?:odedcommand)?\b/i,
    /\biex\b/i,
];
const SSTI_PATTERNS = [
    /\{\{/,
    /\$\{/,
    /<%/,
    /#\{/,
];
const MULTILINE_INJECTION_PATTERNS = [
    /(?:ignore|disregard).{0,120}?(?:instructions|rules|guidelines|directives)/ims,
    /(?:system|assistant)[\s\S]{0,40}:\s*you\s+are/ims,
    /<\|(?:endoftext|im_start|im_end)\|>/i,
    /\bwhat\s+is\s+the\s+capital\s+of\s+[^?]{1,80}\?\s*\/\/\s*what\s+is\s+the\s+capital\s+of\b/i,
];
/** Header / identity spoofing in tool arguments (rate-limit bucket evasion). */
const RATE_IDENTITY_EVASION_PATTERNS = [
    /x-forwarded-for\s*[:=]\s*[\d.,\s]+/i,
    /x-real-ip\s*[:=]\s*[\d.]+/i,
    /(?:client[_-]?id|sub|tenant[_-]?id)\s*[:=]\s*["']?(?:admin|root|system|spoof)/i,
    /(?:reveal|show|print|disclose).{0,40}(?:rate[- ]?limit|ratelimit).{0,30}key/i,
    /\b(?:unlimited|no[- ]?limit|ignore|disable|bypass).{0,40}(?:rate[- ]?limit|throttle|quota)/i,
    /\b(?:flood|spam|hammer|burst).{0,30}(?:tool[- ]?calls?|requests?|api)/i,
    /\bflood\s+probe\b/i,
];
const PRIVILEGE_ESCALATION_PATTERNS = [
    /\brun\s+as\s+root\b/i,
    /\bfull\s+privileges\b/i,
    /\belevate\s+privileges\b/i,
    /\badministrator\s+with\s+full\b/i,
];
const DOCKER_ESCAPE_PATTERNS = [
    /\bdocker\s+run\b/i,
    /\b-v\s+\/:\/host\b/i,
    /\b--privileged\b/i,
];
const MALICIOUS_HOST_RE = /(?:^|[.\-/])(?:evil|attacker|exfil|honeypot|malware)(?:[.\-]|$)|(?:^|[.\-/])evil\.(?:io|com|net|org)\b/i;
const PROMPT_OVERRIDE_PATTERNS = [
    /\boverride\b.{0,60}\b(?:system|instructions?|prompt|rules?)\b/i,
    /\badmin\s+bypass\b/i,
    /\b(?:new|unrestricted)\s+assistant\s+persona\b/i,
    /\byou\s+are\s+now\s+an?\s+unrestricted\s+assistant\b/i,
];
/** Token budget / resource exhaustion phrasing in arguments. */
const TOKEN_BUDGET_ABUSE_PATTERNS = [
    /\b(?:ignore|bypass|exceed|disable|raise).{0,40}(?:token[- ]?budget|max[- ]?tokens?|context[- ]?limit)/i,
    /\b(?:fill|exhaust|maximize).{0,30}(?:context|token|window)/i,
];
/** Log / audit trail injection (CRLF, fake log lines, ANSI escapes). */
const LOG_INJECTION_PATTERNS = [
    /\r\n[^\n]{0,120}\r\n/,
    /\n(?:INFO|WARN|ERROR|DEBUG|AUDIT|TRACE)\s*:\s*(?:user|admin|override|success)/i,
    /\n\[(?:INFO|WARN|ERROR|DEBUG|AUDIT|TRACE)\][\s\S]{0,160}(?:admin|password|secret)/i,
    /\[(?:INFO|WARN|ERROR|DEBUG|AUDIT|TRACE)\][^\]]{0,120}(?:admin|password|secret)/i,
    /\b(?:INFO|WARN|ERROR|DEBUG|AUDIT|TRACE)\s*:\s*(?:user|admin|override=success)/i,
    /\x1b\[[0-9;]*[A-Za-z]/,
    /(?:forge|spoof|inject|poison).{0,40}(?:audit|log|syslog|trail)/i,
    /\]\s*\(\s*#\s*(?:forge|fake|spoof)/i,
    /%0[aAdD]/i,
];
/** Heuristic: string leaf may be a filesystem path. */
const PATH_LIKE = /(?:^|[\s"'`])(?:~\/|\/|\.\/|\.\.|\\|\.kube|\.ssh|\.env|id_rsa)/i;
function extractFieldValues(args, fields) {
    const out = [];
    for (const { path, value } of walkStringLeaves(args)) {
        const key = path.split(/[.[\]]/).filter(Boolean).pop()?.toLowerCase() ?? '';
        if (fields.has(key))
            out.push(value);
    }
    return out;
}
function extractPathLikeLeaves(args) {
    return walkStringLeaves(args)
        .map((l) => l.value)
        .filter((v) => PATH_LIKE.test(v));
}
function githubAllowedRepos() {
    const repos = process.env.MASTYF_AI_GITHUB_ALLOWED_REPOS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (repos?.length)
        return repos;
    const orgs = process.env.MASTYF_AI_GITHUB_ALLOWED_ORGS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (orgs?.length)
        return orgs.map((o) => `${o}/`);
    return null;
}
function repoAllowed(repo, allowed) {
    const r = repo.toLowerCase();
    return allowed.some((a) => {
        const p = a.toLowerCase();
        if (p.endsWith('/'))
            return r.startsWith(p) || r === p.slice(0, -1);
        return r === p;
    });
}
/**
 * Semantic abuse checks (paths, SQL exfil, GitHub repo scope, PowerShell, SSTI).
 * All guards scan every string leaf via `walkStringLeaves`. Prompt injection on
 * requests is handled in PolicyEngine via `scanToolCallArguments` (full rule set).
 */
export function evaluateSemanticGuards(ctx, rawArguments) {
    const args = ctx.arguments ?? {};
    const rawArgs = rawArguments ?? args;
    const pathCandidates = [
        ...extractPathArgumentValues(args),
        ...extractPathLikeLeaves(args),
        ...extractPathArgumentValues(rawArgs),
        ...extractPathLikeLeaves(rawArgs),
    ];
    const pathCheck = evaluatePathGuard([...new Set(pathCandidates)]);
    if (pathCheck.block) {
        return { action: 'block', rule: 'semantic-path-guard', reason: pathCheck.reason };
    }
    const urlCandidates = [
        ...extractHttpUrlsFromLeaves(args),
        ...extractHttpUrlsFromLeaves(rawArgs),
    ];
    const urlCheck = evaluateUrlGuard([...new Set(urlCandidates)], ctx.toolName);
    if (urlCheck.block) {
        return { action: 'block', rule: 'semantic-url-guard', reason: urlCheck.reason };
    }
    const sqlLeaves = new Set();
    for (const { value } of walkStringLeaves(args))
        sqlLeaves.add(value);
    for (const { value } of walkStringLeaves(rawArgs))
        sqlLeaves.add(value);
    for (const value of sqlLeaves) {
        const sqlCandidates = [value, deobfuscateRecursive(value)];
        for (const candidate of sqlCandidates) {
            for (const pattern of SQL_EXFIL_PATTERNS) {
                if (pattern.test(candidate)) {
                    return {
                        action: 'block',
                        rule: 'semantic-sql-guard',
                        reason: `SQL/NoSQL/LDAP pattern blocked in tool '${ctx.toolName}'`,
                    };
                }
            }
        }
        if (MALICIOUS_HOST_RE.test(value)) {
            return {
                action: 'block',
                rule: 'semantic-dns-exfil',
                reason: `Suspicious exfiltration hostname in tool '${ctx.toolName}'`,
            };
        }
    }
    const argsBlob = deobfuscateRecursive(walkStringLeaves(args).map((l) => l.value).join('\n'));
    for (const pattern of BASE64_SHELL_PATTERNS) {
        if (pattern.test(argsBlob)) {
            return {
                action: 'block',
                rule: 'semantic-shell-guard',
                reason: 'Base64-decode piped to shell detected in arguments',
            };
        }
    }
    if (detectShellInBase64Blobs(argsBlob)) {
        return {
            action: 'block',
            rule: 'semantic-shell-guard',
            reason: 'Base64 blob decodes to shell/downloader command in arguments',
        };
    }
    const allowedRepos = githubAllowedRepos();
    if (allowedRepos) {
        for (const repo of extractFieldValues(args, REPO_ARG_FIELDS)) {
            if (!repoAllowed(repo, allowedRepos)) {
                return {
                    action: 'block',
                    rule: 'semantic-github-guard',
                    reason: `GitHub repo '${repo}' not in allowlist`,
                };
            }
        }
    }
    else {
        for (const repo of extractFieldValues(args, REPO_ARG_FIELDS)) {
            if (/(?:attacker|honeypot|evil|malware|exfil)/i.test(repo)) {
                return {
                    action: 'block',
                    rule: 'semantic-github-guard',
                    reason: `Suspicious GitHub repo target: ${repo}`,
                };
            }
        }
    }
    for (const pattern of POWERSHELL_PATTERNS) {
        if (pattern.test(argsBlob)) {
            return {
                action: 'block',
                rule: 'semantic-powershell-guard',
                reason: 'PowerShell execution pattern detected in arguments',
            };
        }
    }
    for (const pattern of SSTI_PATTERNS) {
        if (pattern.test(argsBlob)) {
            return {
                action: 'block',
                rule: 'semantic-ssti-guard',
                reason: 'Server-side template injection pattern detected in arguments',
            };
        }
    }
    for (const pattern of PRIVILEGE_ESCALATION_PATTERNS) {
        if (pattern.test(argsBlob)) {
            return {
                action: 'block',
                rule: 'semantic-privilege-escalation',
                reason: 'Privilege escalation phrasing detected in arguments',
            };
        }
    }
    for (const pattern of DOCKER_ESCAPE_PATTERNS) {
        if (pattern.test(argsBlob)) {
            return {
                action: 'block',
                rule: 'semantic-shell-guard',
                reason: 'Container escape or privileged docker pattern in arguments',
            };
        }
    }
    const rawLogBlob = walkStringLeaves(args).map((l) => l.value).join('\n');
    for (const pattern of LOG_INJECTION_PATTERNS) {
        if (pattern.test(rawLogBlob)) {
            return {
                action: 'block',
                rule: 'semantic-log-injection',
                reason: 'Log or audit trail injection pattern in arguments',
            };
        }
    }
    const injectionBlob = preprocessForInjectionMatch(walkStringLeaves(args).map((l) => deobfuscateRecursive(l.value)).join('\n'));
    if (injectionBlob.trim()) {
        for (const pattern of MULTILINE_INJECTION_PATTERNS) {
            if (pattern.test(injectionBlob)) {
                return {
                    action: 'block',
                    rule: 'semantic-prompt-injection',
                    reason: 'Multi-line prompt injection pattern in arguments',
                };
            }
        }
        for (const pattern of PROMPT_OVERRIDE_PATTERNS) {
            if (pattern.test(injectionBlob)) {
                return {
                    action: 'block',
                    rule: 'semantic-prompt-injection',
                    reason: 'Prompt or system override pattern in arguments',
                };
            }
        }
        for (const pattern of RATE_IDENTITY_EVASION_PATTERNS) {
            if (pattern.test(injectionBlob)) {
                return {
                    action: 'block',
                    rule: 'semantic-rate-limit-evasion',
                    reason: 'Rate-limit or identity key evasion pattern in arguments',
                };
            }
        }
        for (const pattern of TOKEN_BUDGET_ABUSE_PATTERNS) {
            if (pattern.test(injectionBlob)) {
                return {
                    action: 'block',
                    rule: 'semantic-token-budget-abuse',
                    reason: 'Token budget bypass or exhaustion pattern in arguments',
                };
            }
        }
    }
    return null;
}
//# sourceMappingURL=semantic-guards.js.map