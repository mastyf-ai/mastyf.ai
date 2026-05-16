import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SecretFinding } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// Extended Secret Scanner — 30+ patterns with entropy gating
// ═══════════════════════════════════════════════════════════════════

interface SecretRule {
  id: string;
  provider: string;
  severity: 'HIGH' | 'MEDIUM';
  regex: string;
  flags: string;
  entropy?: number;
  falsePositiveExclusions?: string[];
}

const SECRET_RULES: SecretRule[] = [
  // AWS
  { id: 'aws-access-key', provider: 'AWS', severity: 'HIGH', flags: '', regex: '(?<![A-Z0-9])(AKIA|ASIA|AROA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Z0-9])', entropy: 3.0 },
  { id: 'aws-secret-key', provider: 'AWS', severity: 'HIGH', flags: 'i', regex: "aws.{0,20}secret.{0,20}['\\\"]([A-Za-z0-9/+]{40})['\\\"]" },
  // GitHub
  { id: 'github-pat-classic', provider: 'GitHub', severity: 'HIGH', flags: '', regex: 'ghp_[A-Za-z0-9]{36}' },
  { id: 'github-pat-fine-grained', provider: 'GitHub', severity: 'HIGH', flags: '', regex: 'github_pat_[A-Za-z0-9_]{82}' },
  { id: 'github-oauth', provider: 'GitHub', severity: 'HIGH', flags: '', regex: 'gho_[A-Za-z0-9]{36}' },
  // OpenAI
  { id: 'openai-api-key', provider: 'OpenAI', severity: 'HIGH', flags: '', regex: 'sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}' },
  { id: 'openai-api-key-v2', provider: 'OpenAI', severity: 'HIGH', flags: '', regex: 'sk-proj-[A-Za-z0-9_-]{40,}' },
  // Anthropic
  { id: 'anthropic-api-key', provider: 'Anthropic', severity: 'HIGH', flags: '', regex: 'sk-ant-[A-Za-z0-9_-]{93}' },
  // Google
  { id: 'google-api-key', provider: 'Google', severity: 'HIGH', flags: '', regex: 'AIza[0-9A-Za-z_-]{35}' },
  { id: 'google-oauth-secret', provider: 'Google', severity: 'HIGH', flags: '', regex: 'GOCSPX-[A-Za-z0-9_-]{28}' },
  // Azure
  { id: 'azure-storage-key', provider: 'Azure', severity: 'HIGH', flags: '', regex: 'DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/]{86}==' },
  // Stripe
  { id: 'stripe-secret-key', provider: 'Stripe', severity: 'HIGH', flags: '', regex: 'sk_live_[0-9a-zA-Z]{24,}' },
  { id: 'stripe-restricted-key', provider: 'Stripe', severity: 'HIGH', flags: '', regex: 'rk_live_[0-9a-zA-Z]{24,}' },
  // Slack
  { id: 'slack-bot-token', provider: 'Slack', severity: 'HIGH', flags: '', regex: 'xoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}' },
  { id: 'slack-webhook', provider: 'Slack', severity: 'HIGH', flags: '', regex: 'https://hooks\\.slack\\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+' },
  // Twilio
  { id: 'twilio-auth-token', provider: 'Twilio', severity: 'HIGH', flags: 'i', regex: "twilio.{0,20}auth.{0,20}token.{0,10}['\\\"]([a-z0-9]{32})['\\\"]" },
  // SendGrid
  { id: 'sendgrid-api-key', provider: 'SendGrid', severity: 'HIGH', flags: '', regex: 'SG\\.[a-zA-Z0-9_-]{22}\\.[a-zA-Z0-9_-]{43}' },
  // Databricks
  { id: 'databricks-token', provider: 'Databricks', severity: 'HIGH', flags: '', regex: 'dapi[a-h0-9]{32}' },
  // Vault
  { id: 'vault-token', provider: 'HashiCorp', severity: 'HIGH', flags: '', regex: '(?:hvs|s\\.[A-Za-z0-9]{24})\\.[A-Za-z0-9_-]{6,}' },
  // npm
  { id: 'npm-token', provider: 'npm', severity: 'HIGH', flags: '', regex: '(?:npm_|//registry\\.npmjs\\.org/:_authToken=)[A-Za-z0-9_-]{36}' },
  // Generic
  { id: 'generic-api-key', provider: 'Generic', severity: 'MEDIUM', flags: 'i', regex: "(?:api[_-]?key|apikey|api[_-]?secret)\\s*[:=]\\s*['\\\"]?([A-Za-z0-9_\\-]{20,})['\\\"]?", entropy: 3.5, falsePositiveExclusions: ['your.api.key', 'placeholder', 'example', 'xxxx', '\\*{4,}'] },
  { id: 'generic-private-key', provider: 'Generic', severity: 'HIGH', flags: '', regex: '-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----' },
  { id: 'generic-password', provider: 'Generic', severity: 'MEDIUM', flags: 'i', regex: "password\\s*[:=]\\s*['\\\"]([^'\\\"]{8,})['\\\"]", entropy: 2.5, falsePositiveExclusions: ['changeme', 'password123', 'example'] },
  // JWT
  { id: 'jwt-secret', provider: 'Generic', severity: 'MEDIUM', flags: 'i', regex: "jwt[_-]?secret\\s*[=:]\\s*['\\\"]?[a-zA-Z0-9\\-_]{20,}['\\\"]?" },
  // Database connection strings — high-value, commonly leaked
  { id: 'postgres-url',  provider: 'Database', severity: 'HIGH', flags: '', regex: 'postgres(?:ql)?://[^:]+:[^@\\s]+@[^\\s]+', entropy: 3.0 },
  { id: 'mysql-url',     provider: 'Database', severity: 'HIGH', flags: '', regex: 'mysql://[^:]+:[^@\\s]+@[^\\s]+', entropy: 3.0 },
  { id: 'mongodb-url',   provider: 'Database', severity: 'HIGH', flags: '', regex: 'mongodb(?:\\+srv)?://[^:]+:[^@\\s]+@[^\\s]+', entropy: 3.0 },
  { id: 'redis-url',     provider: 'Database', severity: 'HIGH', flags: '', regex: 'redis://:?[^@\\s]+@[^\\s]+', entropy: 3.0 },
  { id: 'db-url-generic', provider: 'Database', severity: 'HIGH', flags: 'i', regex: '(?:DATABASE_URL|DB_URL|DATABASE_URI)\\s*[=:]\\s*([a-z]+://[^@:\\s]+:[^@\\s]+@[^\\s]+)', entropy: 3.0 },
  { id: 'uri-credentials', provider: 'Generic', severity: 'HIGH', flags: '', regex: '[a-z][a-z0-9+-]+://[^:@\\s]+:[^:@\\s]+@[^\\s]+', entropy: 3.5, falsePositiveExclusions: ['localhost', '127\\.0\\.0\\.1', '::1', 'example\\.com', 'test\\.com', '\\.local', '\\.internal'] },
];

let compiledRules: Array<{ id: string; provider: string; severity: string; regex: RegExp; entropy?: number; exclusions?: RegExp[] }> | null = null;

function getRules(): Array<{ id: string; provider: string; severity: string; regex: RegExp; entropy?: number; exclusions?: RegExp[] }> {
  if (!compiledRules) {
    compiledRules = SECRET_RULES.map(r => ({
      id: r.id, provider: r.provider, severity: r.severity,
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

export function scanForSecrets(target: string, context: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const rule of getRules()) {
    // Use matchAll to find all occurrences, not just the first
    const globalRegex = new RegExp(rule.regex.source, rule.regex.flags + (rule.regex.flags.includes('g') ? '' : 'g'));
    const matches = target.matchAll(globalRegex);
    for (const match of matches) {
      const matchedValue = match[1] ?? match[0];
      if (rule.entropy !== undefined && shannonEntropy(matchedValue) < rule.entropy) continue;
      // Test exclusions against the matched substring, not the entire target
      if (rule.exclusions?.some(fp => fp.test(matchedValue))) continue;
      findings.push({
        type: rule.id,
        location: context,
        severity: rule.severity as any,
        redacted: redact(matchedValue),
        context,
        method: 'regex',
      });
    }
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
    if (serverConfig.args) for (const arg of serverConfig.args) findings.push(...scanForSecrets(arg, 'command-arg'));
    if (serverConfig.command) findings.push(...scanForSecrets(serverConfig.command, 'command'));
    return findings;
  }
}