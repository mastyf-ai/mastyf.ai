import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SecretFinding } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Named regex patterns (50 patterns)
// Patterns stored as strings to avoid tsc regex-parsing bugs
// ═══════════════════════════════════════════════════════════════════

const SECRET_RULES: Array<{ name: string; regex: string; flags: string; severity: 'HIGH' | 'MEDIUM' }> = [
  // OpenAI
  { name: 'openai-key',           severity: 'HIGH',   flags: '',   regex: 'sk-[a-zA-Z0-9]{20,}' },
  { name: 'openai-org',           severity: 'MEDIUM', flags: '',   regex: 'org-[a-zA-Z0-9]{20,}' },
  // Anthropic
  { name: 'anthropic-key',        severity: 'HIGH',   flags: '',   regex: 'sk-ant-[a-zA-Z0-9\\-_]{20,}' },
  // GitHub
  { name: 'github-pat',           severity: 'HIGH',   flags: '',   regex: 'ghp_[a-zA-Z0-9]{36,}' },
  { name: 'github-oauth',         severity: 'HIGH',   flags: '',   regex: 'gho_[a-zA-Z0-9]{36,}' },
  { name: 'github-actions',       severity: 'HIGH',   flags: '',   regex: 'ghs_[a-zA-Z0-9]{36,}' },
  { name: 'github-refresh',       severity: 'HIGH',   flags: '',   regex: 'ghr_[a-zA-Z0-9]{36,}' },
  // AWS
  { name: 'aws-access-key',       severity: 'HIGH',   flags: '',   regex: 'AKIA[0-9A-Z]{16}' },
  { name: 'aws-secret-key',       severity: 'HIGH',   flags: 'i',  regex: "aws(.{0,20})?['\\\"][0-9a-zA-Z/+]{40}['\\\"]" },
  // Google
  { name: 'gcp-api-key',          severity: 'HIGH',   flags: '',   regex: 'AIza[0-9A-Za-z\\-_]{35}' },
  { name: 'gcp-service-account',  severity: 'HIGH',   flags: '',   regex: '"type":\\s*"service_account"' },
  // Azure
  { name: 'azure-storage',        severity: 'HIGH',   flags: '',   regex: 'DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{44,}' },
  // Stripe
  { name: 'stripe-live-key',      severity: 'HIGH',   flags: '',   regex: 'sk_live_[0-9a-zA-Z]{24,}' },
  { name: 'stripe-test-key',      severity: 'MEDIUM', flags: '',   regex: 'sk_test_[0-9a-zA-Z]{24,}' },
  { name: 'stripe-restricted',    severity: 'HIGH',   flags: '',   regex: 'rk_live_[0-9a-zA-Z]{24,}' },
  // Slack
  { name: 'slack-bot-token',      severity: 'HIGH',   flags: '',   regex: 'xoxb-[0-9]{11}-[0-9]{11}-[0-9a-zA-Z]{24}' },
  { name: 'slack-user-token',     severity: 'HIGH',   flags: '',   regex: 'xoxp-[0-9]{11}-[0-9]{11}-[0-9]{11}-[0-9a-f]{32}' },
  { name: 'slack-webhook',        severity: 'HIGH',   flags: '',   regex: 'hooks\\.slack\\.com/services/T[0-9A-Z]+/B[0-9A-Z]+/[0-9a-zA-Z]+' },
  // Twilio
  { name: 'twilio-account',       severity: 'HIGH',   flags: '',   regex: 'AC[a-z0-9]{32}' },
  { name: 'twilio-auth',          severity: 'HIGH',   flags: '',   regex: 'SK[a-z0-9]{32}' },
  // Sendgrid
  { name: 'sendgrid-key',         severity: 'HIGH',   flags: '',   regex: 'SG\\.[0-9A-Za-z\\-_]{22}\\.[0-9A-Za-z\\-_]{43}' },
  // Heroku
  { name: 'heroku-api-key',       severity: 'HIGH',   flags: '',   regex: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' },
  // Generic secrets in env vars
  { name: 'generic-api-key',      severity: 'MEDIUM', flags: 'i',  regex: "(api[_-]?key|apikey)\\s*[=:]\\s*['\"]?[0-9a-zA-Z\\-_]{20,}['\"]?" },
  { name: 'generic-password',     severity: 'MEDIUM', flags: 'i',  regex: "(password|passwd|pwd)\\s*[=:]\\s*['\"]?[^\\s'\"]{8,}['\"]?" },
  { name: 'generic-secret',       severity: 'MEDIUM', flags: 'i',  regex: "(secret[_-]?key|secretkey)\\s*[=:]\\s*['\"]?[0-9a-zA-Z\\-_]{20,}['\"]?" },
  { name: 'generic-token',        severity: 'MEDIUM', flags: 'i',  regex: "(auth[_-]?token|access[_-]?token)\\s*[=:]\\s*['\"]?[0-9a-zA-Z\\-_.]{20,}['\"]?" },
  // RSA / PEM
  { name: 'rsa-private-key',      severity: 'HIGH',   flags: '',   regex: '-----BEGIN RSA PRIVATE KEY-----' },
  { name: 'private-key',          severity: 'HIGH',   flags: '',   regex: '-----BEGIN PRIVATE KEY-----' },
  { name: 'ec-private-key',       severity: 'HIGH',   flags: '',   regex: '-----BEGIN EC PRIVATE KEY-----' },
  { name: 'pgp-private-key',      severity: 'HIGH',   flags: '',   regex: '-----BEGIN PGP PRIVATE KEY BLOCK-----' },
  // NPM
  { name: 'npm-token',            severity: 'HIGH',   flags: '',   regex: '(?:npm_)[a-zA-Z0-9]{36,}' },
  // Vercel
  { name: 'vercel-token',         severity: 'HIGH',   flags: 'i',  regex: "vercel(.{0,20})?token\\s*[=:]\\s*['\"]?[a-zA-Z0-9]{24,}['\"]?" },
  // Database connection strings
  { name: 'postgres-url',         severity: 'HIGH',   flags: '',   regex: 'postgres(?:ql)?://[^:]+:[^@]+@' },
  { name: 'mysql-url',            severity: 'HIGH',   flags: '',   regex: 'mysql://[^:]+:[^@]+@' },
  { name: 'mongodb-url',          severity: 'HIGH',   flags: '',   regex: 'mongodb(?:\\+srv)?://[^:]+:[^@]+@' },
  { name: 'redis-url',            severity: 'HIGH',   flags: '',   regex: 'redis://:?[^@]+@' },
  // JWT-shaped secrets
  { name: 'jwt-secret',           severity: 'MEDIUM', flags: 'i',  regex: "jwt[_-]?secret\\s*[=:]\\s*['\"]?[a-zA-Z0-9\\-_]{20,}['\"]?" },
  // GitLab
  { name: 'gitlab-pat',           severity: 'HIGH',   flags: '',   regex: 'glpat-[a-zA-Z0-9\\-_]{20,}' },
  { name: 'gitlab-oauth',         severity: 'HIGH',   flags: '',   regex: 'gloa-[a-zA-Z0-9\\-_]{20,}' },
  // Datadog
  { name: 'datadog-api-key',      severity: 'HIGH',   flags: 'i',  regex: "datadog(.{0,10})?api[_-]?key\\s*[=:]\\s*['\"]?[a-f0-9]{32}['\"]?" },
  { name: 'datadog-app-key',      severity: 'HIGH',   flags: 'i',  regex: "datadog(.{0,10})?app(?:lication)?[_-]?key\\s*[=:]\\s*['\"]?[a-f0-9]{40}['\"]?" },
  // CircleCI
  { name: 'circleci-token',       severity: 'HIGH',   flags: 'i',  regex: "circle(.{0,5})?token\\s*[=:]\\s*['\"]?[a-f0-9]{40}['\"]?" },
  // Jenkins
  { name: 'jenkins-token',        severity: 'HIGH',   flags: 'i',  regex: "jenkins(.{0,5})?token\\s*[=:]\\s*['\"]?[a-f0-9]{32}['\"]?" },
  // Firebase
  { name: 'firebase-token',       severity: 'HIGH',   flags: 'i',  regex: "firebase(.{0,5})?token\\s*[=:]\\s*['\"]?[a-zA-Z0-9\\-_]{100,}['\"]?" },
  // Cloudflare
  { name: 'cloudflare-api',       severity: 'HIGH',   flags: 'i',  regex: "cloudflare(.{0,10})?api[_-]?token\\s*[=:]\\s*['\"]?[a-zA-Z0-9\\-_]{40}['\"]?" },
  // HuggingFace
  { name: 'huggingface-token',    severity: 'HIGH',   flags: '',   regex: 'hf_[a-zA-Z0-9]{34}' },
  // Generic connection URI with credentials
  { name: 'uri-credentials',      severity: 'HIGH',   flags: '',   regex: '[a-z]+://[^:@\\s]+:[^:@\\s]+@[^\\s]+' },
];

// Lazy-compiled patterns cache
let compiledPatterns: Array<{ name: string; pattern: RegExp; severity: 'HIGH' | 'MEDIUM' }> | null = null;

function getPatterns(): Array<{ name: string; pattern: RegExp; severity: 'HIGH' | 'MEDIUM' }> {
  if (!compiledPatterns) {
    compiledPatterns = SECRET_RULES.map(r => ({
      name: r.name,
      severity: r.severity,
      pattern: new RegExp(r.regex, r.flags),
    }));
  }
  return compiledPatterns;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Shannon entropy analysis for base64/hex secrets
// ═══════════════════════════════════════════════════════════════════

function shannonEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const ch of str) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }
  return Object.values(freq).reduce((acc, count) => {
    const p = count / str.length;
    return acc - p * Math.log2(p);
  }, 0);
}

const HIGH_ENTROPY_PATTERN = /[a-zA-Z0-9+/=_\-]{20,}/g;
const ENTROPY_THRESHOLD = 4.5;

const KNOWN_ALLOWLIST = new Set<string>(
  (process.env['MCP_GUARDIAN_SECRET_ALLOWLIST']?.split(',') ?? []).filter(Boolean)
);

// ═══════════════════════════════════════════════════════════════════
// Scan function: regex + entropy + allowlist
// ═══════════════════════════════════════════════════════════════════

export function scanForSecrets(target: string, context: string): SecretFinding[] {
  const findings: SecretFinding[] = [];

  // Pass 1: Named regex patterns
  for (const { name, pattern, severity } of getPatterns()) {
    let match;
    let lastIndexSaved: number | undefined;
    // Reset lastIndex if the regex is stateful (global)
    if (pattern.global) {
      lastIndexSaved = pattern.lastIndex;
      pattern.lastIndex = 0;
    }
    while ((match = pattern.exec(target)) !== null) {
      const matched = match[0];
      const redacted = matched.length > 10
        ? matched.slice(0, 6) + '[REDACTED]' + matched.slice(-4)
        : matched;
      findings.push({
        type: name,
        location: context,
        severity,
        redacted,
        context,
        method: 'regex',
      });
      if (matched.length === 0) break;
    }
  }

  // Pass 2: Entropy analysis
  const entropyMatches = target.matchAll(HIGH_ENTROPY_PATTERN);
  for (const match of entropyMatches) {
    const candidate = match[0];
    if (KNOWN_ALLOWLIST.has(candidate)) continue;
    if (shannonEntropy(candidate) >= ENTROPY_THRESHOLD) {
      const alreadyReported = findings.some(f =>
        f.redacted?.startsWith(candidate.slice(0, 6))
      );
      if (!alreadyReported) {
        findings.push({
          type: 'high-entropy-string',
          location: context,
          severity: 'medium',
          context,
          redacted: candidate.slice(0, 6) + '[REDACTED]' + candidate.slice(-4),
          method: 'entropy',
        });
      }
    }
  }

  return findings;
}

export function scanAdjacentFiles(configDir: string): SecretFinding[] {
  const targets = [
    join(configDir, '.env'),
    join(configDir, '.env.local'),
    join(configDir, '.env.production'),
    join(configDir, 'docker-compose.yml'),
    join(configDir, 'docker-compose.yaml'),
  ];

  const findings: SecretFinding[] = [];
  for (const t of targets) {
    if (existsSync(t)) {
      const content = readFileSync(t, 'utf8');
      findings.push(...scanForSecrets(content, t));
    }
  }
  return findings;
}

export class SecretScanner {
  scan(serverConfig: { name: string; args?: string[]; env?: Record<string, string>; command?: string }): SecretFinding[] {
    const findings: SecretFinding[] = [];

    if (serverConfig.env) {
      for (const [key, value] of Object.entries(serverConfig.env)) {
        if (value && typeof value === 'string' && value.length >= 8) {
          findings.push(...scanForSecrets(value, `env:${key}`));
        }
      }
    }

    if (serverConfig.args) {
      for (const arg of serverConfig.args) {
        findings.push(...scanForSecrets(arg, 'command-arg'));
      }
    }

    if (serverConfig.command) {
      findings.push(...scanForSecrets(serverConfig.command, 'command'));
    }

    return findings;
  }
}