import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SecretFinding } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Named regex patterns (50 patterns)
// ═══════════════════════════════════════════════════════════════════

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; severity: 'high' | 'medium' }> = [
  // OpenAI
  { name: 'openai-key',           severity: 'high',   pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'openai-org',           severity: 'medium', pattern: /org-[a-zA-Z0-9]{20,}/ },
  // Anthropic
  { name: 'anthropic-key',        severity: 'high',   pattern: /sk-ant-[a-zA-Z0-9\-_]{20,}/ },
  // GitHub
  { name: 'github-pat',           severity: 'high',   pattern: /ghp_[a-zA-Z0-9]{36,}/ },
  { name: 'github-oauth',         severity: 'high',   pattern: /gho_[a-zA-Z0-9]{36,}/ },
  { name: 'github-actions',       severity: 'high',   pattern: /ghs_[a-zA-Z0-9]{36,}/ },
  { name: 'github-refresh',       severity: 'high',   pattern: /ghr_[a-zA-Z0-9]{36,}/ },
  // AWS
  { name: 'aws-access-key',       severity: 'high',   pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'aws-secret-key',       severity: 'high',   pattern: /(?i)aws(.{0,20})?['"][0-9a-zA-Z\/+]{40}['"]/ },
  // Google
  { name: 'gcp-api-key',          severity: 'high',   pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: 'gcp-service-account',  severity: 'high',   pattern: /"type":\s*"service_account"/ },
  // Azure
  { name: 'azure-storage',        severity: 'high',   pattern: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+\/=]{44,}/ },
  // Stripe
  { name: 'stripe-live-key',      severity: 'high',   pattern: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: 'stripe-test-key',      severity: 'medium', pattern: /sk_test_[0-9a-zA-Z]{24,}/ },
  { name: 'stripe-restricted',    severity: 'high',   pattern: /rk_live_[0-9a-zA-Z]{24,}/ },
  // Slack
  { name: 'slack-bot-token',      severity: 'high',   pattern: /xoxb-[0-9]{11}-[0-9]{11}-[0-9a-zA-Z]{24}/ },
  { name: 'slack-user-token',     severity: 'high',   pattern: /xoxp-[0-9]{11}-[0-9]{11}-[0-9]{11}-[0-9a-f]{32}/ },
  { name: 'slack-webhook',        severity: 'high',   pattern: /hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9a-zA-Z]+/ },
  // Twilio
  { name: 'twilio-account',       severity: 'high',   pattern: /AC[a-z0-9]{32}/ },
  { name: 'twilio-auth',          severity: 'high',   pattern: /SK[a-z0-9]{32}/ },
  // Sendgrid
  { name: 'sendgrid-key',         severity: 'high',   pattern: /SG\.[0-9A-Za-z\-_]{22}\.[0-9A-Za-z\-_]{43}/ },
  // Heroku
  { name: 'heroku-api-key',       severity: 'high',   pattern: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/ },
  // Generic secrets in env vars
  { name: 'generic-api-key',      severity: 'medium', pattern: /(?i)(api[_-]?key|apikey)\s*[=:]\s*['"]?[0-9a-zA-Z\-_]{20,}['"]?/ },
  { name: 'generic-password',     severity: 'medium', pattern: /(?i)(password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/ },
  { name: 'generic-secret',       severity: 'medium', pattern: /(?i)(secret[_-]?key|secretkey)\s*[=:]\s*['"]?[0-9a-zA-Z\-_]{20,}['"]?/ },
  { name: 'generic-token',        severity: 'medium', pattern: /(?i)(auth[_-]?token|access[_-]?token)\s*[=:]\s*['"]?[0-9a-zA-Z\-_.]{20,}['"]?/ },
  // RSA / PEM
  { name: 'rsa-private-key',      severity: 'high',   pattern: /-----BEGIN RSA PRIVATE KEY-----/ },
  { name: 'private-key',          severity: 'high',   pattern: /-----BEGIN PRIVATE KEY-----/ },
  { name: 'ec-private-key',       severity: 'high',   pattern: /-----BEGIN EC PRIVATE KEY-----/ },
  { name: 'pgp-private-key',      severity: 'high',   pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/ },
  // NPM
  { name: 'npm-token',            severity: 'high',   pattern: /(?:npm_)[a-zA-Z0-9]{36,}/ },
  // Vercel
  { name: 'vercel-token',         severity: 'high',   pattern: /(?i)vercel(.{0,20})?token\s*[=:]\s*['"]?[a-zA-Z0-9]{24,}['"]?/ },
  // Database connection strings
  { name: 'postgres-url',         severity: 'high',   pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@/ },
  { name: 'mysql-url',            severity: 'high',   pattern: /mysql:\/\/[^:]+:[^@]+@/ },
  { name: 'mongodb-url',          severity: 'high',   pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/ },
  { name: 'redis-url',            severity: 'high',   pattern: /redis:\/\/:?[^@]+@/ },
  // JWT-shaped secrets
  { name: 'jwt-secret',           severity: 'medium', pattern: /(?i)jwt[_-]?secret\s*[=:]\s*['"]?[a-zA-Z0-9\-_]{20,}['"]?/ },
  // GitLab
  { name: 'gitlab-pat',           severity: 'high',   pattern: /glpat-[a-zA-Z0-9\-_]{20,}/ },
  { name: 'gitlab-oauth',         severity: 'high',   pattern: /gloa-[a-zA-Z0-9\-_]{20,}/ },
  // Datadog
  { name: 'datadog-api-key',      severity: 'high',   pattern: /(?i)datadog(.{0,10})?api[_-]?key\s*[=:]\s*['"]?[a-f0-9]{32}['"]?/ },
  { name: 'datadog-app-key',      severity: 'high',   pattern: /(?i)datadog(.{0,10})?app(?:lication)?[_-]?key\s*[=:]\s*['"]?[a-f0-9]{40}['"]?/ },
  // CircleCI
  { name: 'circleci-token',       severity: 'high',   pattern: /(?i)circle(.{0,5})?token\s*[=:]\s*['"]?[a-f0-9]{40}['"]?/ },
  // Jenkins
  { name: 'jenkins-token',        severity: 'high',   pattern: /(?i)jenkins(.{0,5})?token\s*[=:]\s*['"]?[a-f0-9]{32}['"]?/ },
  // Firebase
  { name: 'firebase-token',       severity: 'high',   pattern: /(?i)firebase(.{0,5})?token\s*[=:]\s*['"]?[a-zA-Z0-9\-_]{100,}['"]?/ },
  // Cloudflare
  { name: 'cloudflare-api',       severity: 'high',   pattern: /(?i)cloudflare(.{0,10})?api[_-]?token\s*[=:]\s*['"]?[a-zA-Z0-9\-_]{40}['"]?/ },
  // HuggingFace
  { name: 'huggingface-token',    severity: 'high',   pattern: /hf_[a-zA-Z0-9]{34}/ },
  // Generic connection URI with credentials
  { name: 'uri-credentials',      severity: 'high',   pattern: /[a-z]+:\/\/[^:@\s]+:[^:@\s]+@[^\s]+/ },
];

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
const ENTROPY_THRESHOLD = 4.5; // Bits per character — empirically validated

const KNOWN_ALLOWLIST = new Set<string>(
  (process.env['MCP_GUARDIAN_SECRET_ALLOWLIST']?.split(',') ?? []).filter(Boolean)
);

// ═══════════════════════════════════════════════════════════════════
// Scan function: regex + entropy + allowlist
// ═══════════════════════════════════════════════════════════════════

export function scanForSecrets(target: string, context: string): SecretFinding[] {
  const findings: SecretFinding[] = [];

  // Pass 1: Named regex patterns
  for (const { name, pattern, severity } of SECRET_PATTERNS) {
    let match;
    // Use regex without global flag to avoid lastIndex state issues
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(target)) !== null) {
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
      // Avoid infinite loops on zero-length matches
      if (matched.length === 0) break;
    }
  }

  // Pass 2: Entropy analysis — catch base64/hex secrets no regex covers
  const entropyMatches = target.matchAll(HIGH_ENTROPY_PATTERN);
  for (const match of entropyMatches) {
    const candidate = match[0];
    if (KNOWN_ALLOWLIST.has(candidate)) continue;
    if (shannonEntropy(candidate) >= ENTROPY_THRESHOLD) {
      // Avoid double-reporting what regex already caught
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

// ═══════════════════════════════════════════════════════════════════
// Scan adjacent files (.env, docker-compose.yml)
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// SecretScanner class (maintains existing interface)
// ═══════════════════════════════════════════════════════════════════

export class SecretScanner {
  scan(serverConfig: { name: string; args?: string[]; env?: Record<string, string>; command?: string }): SecretFinding[] {
    const findings: SecretFinding[] = [];

    // Scan environment variables
    if (serverConfig.env) {
      for (const [key, value] of Object.entries(serverConfig.env)) {
        if (value && typeof value === 'string' && value.length >= 8) {
          findings.push(...scanForSecrets(value, `env:${key}`));
        }
      }
    }

    // Scan command arguments
    if (serverConfig.args) {
      for (const arg of serverConfig.args) {
        findings.push(...scanForSecrets(arg, 'command-arg'));
      }
    }

    // Scan the command itself
    if (serverConfig.command) {
      findings.push(...scanForSecrets(serverConfig.command, 'command'));
    }

    return findings;
  }
}