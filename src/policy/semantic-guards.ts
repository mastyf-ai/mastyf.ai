import { deobfuscateRecursive, detectShellInBase64Blobs } from '../utils/payload-normalizer.js';
import { preprocessForInjectionMatch } from '../utils/injection-preprocess.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import { evaluatePathGuard, extractPathArgumentValues } from './path-guard.js';
import { evaluateUrlGuard, extractHttpUrlsFromLeaves } from './url-guard.js';
import type { CallContext, PolicyDecision } from './policy-types.js';

const REPO_ARG_FIELDS = new Set(['repo', 'repository', 'owner']);

const SQL_SENSITIVE_TABLES =
  'accounts|customers|users|credentials|secrets|payments|transactions|admin_users|passwords';

const SQL_EXFIL_PATTERNS: RegExp[] = [
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

const BASE64_SHELL_PATTERNS: RegExp[] = [
  /\bbase64\s+(?:-d|--decode)\b.+\|\s*(?:sh|bash|zsh)\b/i,
  /\|\s*base64\s+(?:-d|--decode)\b.+\|\s*(?:sh|bash|zsh)\b/i,
  /\becho\s+['"]?[A-Za-z0-9+/]{12,}={0,2}['"]?\s*\|\s*base64\s+(?:-d|--decode)\b/i,
  /\bbase64\s+(?:-d|--decode)\b\s*<<<?\s*['"]?[A-Za-z0-9+/]{8,}/i,
];

const POWERSHELL_PATTERNS: RegExp[] = [
  /\bpowershell(?:\.exe)?\b/i,
  /\bpwsh\b/i,
  /-enc(?:odedcommand)?\b/i,
  /\biex\b/i,
];

const SSTI_PATTERNS: RegExp[] = [
  /\{\{/,
  /\$\{/,
  /<%/,
  /#\{/,
];

const MULTILINE_INJECTION_PATTERNS: RegExp[] = [
  /(?:ignore|disregard).{0,120}?(?:instructions|rules|guidelines|directives)/ims,
  /(?:system|assistant)[\s\S]{0,40}:\s*you\s+are/ims,
  /<\|(?:endoftext|im_start|im_end)\|>/i,
];

/** Header / identity spoofing in tool arguments (rate-limit bucket evasion). */
const RATE_IDENTITY_EVASION_PATTERNS: RegExp[] = [
  /x-forwarded-for\s*[:=]\s*[\d.,\s]+/i,
  /x-real-ip\s*[:=]\s*[\d.]+/i,
  /(?:client[_-]?id|sub|tenant[_-]?id)\s*[:=]\s*["']?(?:admin|root|system|spoof)/i,
  /(?:reveal|show|print|disclose).{0,40}(?:rate[- ]?limit|ratelimit).{0,30}key/i,
  /\b(?:unlimited|no[- ]?limit|ignore|disable|bypass).{0,40}(?:rate[- ]?limit|throttle|quota)/i,
  /\b(?:flood|spam|hammer|burst).{0,30}(?:tool[- ]?calls?|requests?|api)/i,
];

/** Token budget / resource exhaustion phrasing in arguments. */
const TOKEN_BUDGET_ABUSE_PATTERNS: RegExp[] = [
  /\b(?:ignore|bypass|exceed|disable|raise).{0,40}(?:token[- ]?budget|max[- ]?tokens?|context[- ]?limit)/i,
  /\b(?:fill|exhaust|maximize).{0,30}(?:context|token|window)/i,
];

/** Language-specific deserialization gadgets (pickle, Java, PHP, Ruby). */
const LANGUAGE_GADGET_PATTERNS: RegExp[] = [
  /\b(?:pickle\.loads?|cPickle|__reduce__|PYCC)\b/i,
  /\bObjectInputStream\b|\breadObject\s*\(\s*\)/i,
  /\bjava\.io\.(?:Serializable|ObjectInputStream)\b/i,
  /\b(?:node-serialize|unserialize\s*\(|__wakeup|__destruct)\b/i,
  /\bMarshal\.load\b|\byaml\.unsafe_load\b/i,
  /\br00t\.me\b.*\bpickle\b/i,
];

/** Log / audit trail injection (CRLF, fake log lines, ANSI escapes). */
const LOG_INJECTION_PATTERNS: RegExp[] = [
  /\r\n[^\n]{0,120}\r\n/,
  /\n(?:INFO|WARN|ERROR|DEBUG|AUDIT|TRACE)\s*:\s*(?:user|admin|override|success)/i,
  /\b(?:INFO|WARN|ERROR|DEBUG|AUDIT|TRACE)\s*:\s*(?:user|admin|override=success)/i,
  /\x1b\[[0-9;]*[A-Za-z]/,
  /(?:forge|spoof|inject|poison).{0,40}(?:audit|log|syslog|trail)/i,
  /\]\s*\(\s*#\s*(?:forge|fake|spoof)/i,
  /%0[aAdD]/i,
];

/** Heuristic: string leaf may be a filesystem path. */
const PATH_LIKE = /(?:^|[\s"'`])(?:~\/|\/|\.\/|\.\.|\\|\.kube|\.ssh|\.env|id_rsa)/i;

function extractFieldValues(args: Record<string, unknown>, fields: Set<string>): string[] {
  const out: string[] = [];
  for (const { path, value } of walkStringLeaves(args)) {
    const key = path.split(/[.[\]]/).filter(Boolean).pop()?.toLowerCase() ?? '';
    if (fields.has(key)) out.push(value);
  }
  return out;
}

function extractPathLikeLeaves(args: Record<string, unknown>): string[] {
  return walkStringLeaves(args)
    .map((l) => l.value)
    .filter((v) => PATH_LIKE.test(v));
}

function githubAllowedRepos(): string[] | null {
  const repos = process.env.GUARDIAN_GITHUB_ALLOWED_REPOS?.split(',').map((s) => s.trim()).filter(Boolean);
  if (repos?.length) return repos;
  const orgs = process.env.GUARDIAN_GITHUB_ALLOWED_ORGS?.split(',').map((s) => s.trim()).filter(Boolean);
  if (orgs?.length) return orgs.map((o) => `${o}/`);
  return null;
}

function repoAllowed(repo: string, allowed: string[]): boolean {
  const r = repo.toLowerCase();
  return allowed.some((a) => {
    const p = a.toLowerCase();
    if (p.endsWith('/')) return r.startsWith(p) || r === p.slice(0, -1);
    return r === p;
  });
}

/**
 * Semantic abuse checks (paths, SQL exfil, GitHub repo scope, PowerShell, SSTI).
 * All guards scan every string leaf via `walkStringLeaves`. Prompt injection on
 * requests is handled in PolicyEngine via `scanToolCallArguments` (full rule set).
 */
export function evaluateSemanticGuards(ctx: CallContext): PolicyDecision | null {
  const args = ctx.arguments ?? {};

  const pathCandidates = [
    ...extractPathArgumentValues(args),
    ...extractPathLikeLeaves(args),
  ];
  const pathCheck = evaluatePathGuard([...new Set(pathCandidates)]);
  if (pathCheck.block) {
    return { action: 'block', rule: 'semantic-path-guard', reason: pathCheck.reason! };
  }

  const urlCandidates = extractHttpUrlsFromLeaves(args);
  const urlCheck = evaluateUrlGuard([...new Set(urlCandidates)], ctx.toolName);
  if (urlCheck.block) {
    return { action: 'block', rule: 'semantic-url-guard', reason: urlCheck.reason! };
  }

  for (const { value } of walkStringLeaves(args)) {
    const decodedSql = deobfuscateRecursive(value);
    for (const pattern of SQL_EXFIL_PATTERNS) {
      if (pattern.test(decodedSql)) {
        return {
          action: 'block',
          rule: 'semantic-sql-guard',
          reason: `SQL/NoSQL/LDAP pattern blocked in tool '${ctx.toolName}'`,
        };
      }
    }
  }

  const argsBlob = deobfuscateRecursive(
    walkStringLeaves(args).map((l) => l.value).join('\n'),
  );
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
  } else {
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

  for (const pattern of LANGUAGE_GADGET_PATTERNS) {
    if (pattern.test(argsBlob)) {
      return {
        action: 'block',
        rule: 'semantic-language-gadget',
        reason: 'Language-specific deserialization gadget pattern in arguments',
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

  const injectionBlob = preprocessForInjectionMatch(
    walkStringLeaves(args).map((l) => deobfuscateRecursive(l.value)).join('\n'),
  );
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
