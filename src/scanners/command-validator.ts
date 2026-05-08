import { McpServerConfig } from '../types.js';

/**
 * Detects potentially dangerous commands in MCP server configs.
 * Flags: path traversal, shell metacharacters, non-standard executables.
 */
export interface CommandWarning {
  serverName: string;
  field: 'command' | 'args';
  issue: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

const ALLOWED_EXECUTABLES = [
  'npx', 'node', 'python', 'python3', 'uvx', 'deno', 'bun',
  'docker', 'kubectl', 'aws', 'gcloud',
];

const SUSPICIOUS_PATTERNS = [
  { pattern: /\.\.\//, issue: 'Path traversal (../) detected', severity: 'HIGH' as const },
  { pattern: /;\s*\w/, issue: 'Shell command chaining (;) detected', severity: 'HIGH' as const },
  { pattern: /\|\s*\w/, issue: 'Pipe character (|) detected — possible command chaining', severity: 'HIGH' as const },
  { pattern: /\$\{/, issue: 'Shell variable expansion (${}) detected', severity: 'MEDIUM' as const },
  { pattern: /`[^`]+`/, issue: 'Backtick command substitution detected', severity: 'HIGH' as const },
  { pattern: /&&|\|\|/, issue: 'Shell logical operators (&&/||) detected', severity: 'HIGH' as const },
  { pattern: />\s*\//, issue: 'Output redirection (>) to absolute path detected', severity: 'MEDIUM' as const },
  { pattern: /\/etc\/passwd|\/etc\/shadow/, issue: 'Reference to sensitive system file detected', severity: 'HIGH' as const },
  { pattern: /rm\s+-rf/, issue: 'Destructive command (rm -rf) detected', severity: 'HIGH' as const },
  { pattern: /curl\s|wget\s/, issue: 'Network download tool detected in command', severity: 'MEDIUM' as const },
];

export class CommandValidator {
  validate(server: McpServerConfig): CommandWarning[] {
    const warnings: CommandWarning[] = [];

    // Check the command field
    if (server.command) {
      const cmdName = server.command.split('/').pop()?.split(' ')[0] || server.command;
      if (!ALLOWED_EXECUTABLES.includes(cmdName) && !cmdName.startsWith('.')) {
        warnings.push({
          serverName: server.name,
          field: 'command',
          issue: `Unrecognized executable: ${cmdName}. Consider using npx or node.`,
          severity: 'MEDIUM',
        });
      }

      // Check for suspicious patterns
      for (const { pattern, issue, severity } of SUSPICIOUS_PATTERNS) {
        if (pattern.test(server.command)) {
          warnings.push({ serverName: server.name, field: 'command', issue, severity });
        }
      }
    }

    // Check args
    if (server.args) {
      const argsStr = server.args.join(' ');
      for (const { pattern, issue, severity } of SUSPICIOUS_PATTERNS) {
        if (pattern.test(argsStr)) {
          warnings.push({ serverName: server.name, field: 'args', issue, severity });
        }
      }
    }

    return warnings;
  }
}