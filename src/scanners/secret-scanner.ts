import { McpServerConfig, SecretFinding } from '../types.js';

/**
 * Regex patterns for detecting hardcoded secrets in config values.
 */
const SECRET_PATTERNS: { type: string; regex: RegExp }[] = [
  {
    type: 'api_key',
    regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{20,})['"]?/i,
  },
  {
    type: 'token',
    regex: /(?:token|auth|bearer)\s*[:=]\s*['"]?([A-Za-z0-9_\-.]{20,})['"]?/i,
  },
  {
    type: 'private_key',
    regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  },
  {
    type: 'password',
    regex: /(?:password|passwd|pwd)\s*[:=]\s*['"]?([^'"\s]{8,})['"]?/i,
  },
  {
    type: 'github_token',
    regex: /gh[pousr]_[A-Za-z0-9_]{36,}/,
  },
  {
    type: 'openai_key',
    regex: /sk-[A-Za-z0-9]{32,}/,
  },
];

/**
 * Scans MCP server configs for hardcoded secrets in environment variables
 * and command-line arguments.
 */
export class SecretScanner {
  /**
   * Scan a server config for hardcoded secrets.
   */
  scan(server: McpServerConfig): SecretFinding[] {
    const findings: SecretFinding[] = [];

    // Scan environment variable values
    if (server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        if (typeof value !== 'string') continue;
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.regex.test(value)) {
            findings.push({
              type: pattern.type,
              location: `env:${key}`,
              severity: pattern.type === 'private_key' ? 'HIGH' : 'MEDIUM',
            });
          }
        }
      }
    }

    // Scan command-line arguments (might contain inline keys)
    if (server.args && server.args.length > 0) {
      const cmdline = server.args.join(' ');
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(cmdline)) {
          findings.push({
            type: pattern.type,
            location: 'command_args',
            severity: 'HIGH',
          });
        }
      }
    }

    return findings;
  }
}