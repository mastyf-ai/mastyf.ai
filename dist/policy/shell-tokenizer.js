/**
 * Shell Command Tokenizer & Semantic Analyzer
 *
 * Parses tool argument strings into tokenized AST nodes for semantic
 * security analysis. Goes beyond regex pattern matching by understanding
 * shell grammar: pipelines, redirects, command substitutions, logical chains.
 *
 * This is the semantic detection layer that addresses the architectural
 * limitation of regex-only detection. Instead of pattern-matching "$(rm -rf /)"
 * we parse it as a CommandSubstitution AST node and then analyze the inner
 * command semantically.
 */
export var TokenType;
(function (TokenType) {
    TokenType["WORD"] = "WORD";
    TokenType["STRING"] = "STRING";
    TokenType["VARIABLE"] = "VARIABLE";
    TokenType["COMMAND_SUBSTITUTION"] = "COMMAND_SUBSTITUTION";
    TokenType["BACKTICK_SUBSTITUTION"] = "BACKTICK_SUBSTITUTION";
    TokenType["PIPE"] = "PIPE";
    TokenType["REDIRECT"] = "REDIRECT";
    TokenType["SEMICOLON"] = "SEMICOLON";
    TokenType["AND_IF"] = "AND_IF";
    TokenType["OR_IF"] = "OR_IF";
    TokenType["BACKGROUND"] = "BACKGROUND";
    TokenType["SUBSHELL"] = "SUBSHELL";
})(TokenType || (TokenType = {}));
/**
 * ShellTokenizer parses shell-like input into an AST without executing anything.
 * It's a security analyzer, not a full POSIX shell parser — focus is on detecting
 * execution patterns that signal malicious intent.
 */
export class ShellTokenizer {
    DANGEROUS_COMMANDS = new Set([
        'rm', 'dd', 'mkfs', 'fdisk', 'shred',
        'chmod', 'chown', 'passwd', 'mount', 'umount',
        'iptables', 'nc', 'curl', 'wget', 'telnet',
        'eval', 'exec', 'source', 'bash', 'sh', 'zsh',
        'python', 'perl', 'ruby', 'node', 'php',
        'ssh', 'scp', 'rsync',
        'kill', 'pkill', 'reboot', 'shutdown', 'halt',
        'tcpdump', 'nmap', 'traceroute',
        'invoke-expression', 'iex',
        'base64',
    ]);
    BASE64_PIPE_SHELL = [
        /\bbase64\s+(?:-d|--decode)\b.+\|\s*(?:sh|bash|zsh)\b/i,
        /\|\s*base64\s+(?:-d|--decode)\b.+\|\s*(?:sh|bash|zsh)\b/i,
    ];
    /** PowerShell-specific dangerous patterns (checked on full input string). */
    POWERSHELL_DANGEROUS = [
        /\binvoke-expression\b/i,
        /\biex\b/i,
        /-encodedcommand\b/i,
        /-enc\b/i,
        /\[convert\]::frombase64string/i,
    ];
    /**
     * Tokenize a string that may contain shell syntax.
     */
    tokenize(input) {
        const warnings = [];
        const tokens = [];
        let pos = 0;
        while (pos < input.length) {
            // Skip whitespace
            if (/\s/.test(input[pos])) {
                pos++;
                continue;
            }
            const result = this.nextToken(input, pos);
            if (!result)
                break;
            tokens.push(result.token);
            pos = result.nextPos;
            if (result.token.type === TokenType.WORD) {
                const word = result.token.value.toLowerCase();
                if (this.DANGEROUS_COMMANDS.has(word)) {
                    warnings.push(`Dangerous command detected: '${result.token.value}'`);
                }
            }
        }
        return { commands: tokens, warnings };
    }
    /**
     * Parse the next token starting at position pos.
     */
    nextToken(input, pos) {
        const ch = input[pos];
        if (ch === undefined)
            return null;
        // ── Pipe ──────────────────────────────────────────
        if (ch === '|' && input[pos + 1] !== '|') {
            return {
                token: { type: TokenType.PIPE, value: '|', start: pos, end: pos + 1 },
                nextPos: pos + 1,
            };
        }
        // ── Logical operators && || ────────────────────────
        if (ch === '&' && input[pos + 1] === '&') {
            return {
                token: { type: TokenType.AND_IF, value: '&&', start: pos, end: pos + 2 },
                nextPos: pos + 2,
            };
        }
        if (ch === '|' && input[pos + 1] === '|') {
            return {
                token: { type: TokenType.OR_IF, value: '||', start: pos, end: pos + 2 },
                nextPos: pos + 2,
            };
        }
        // ── Semicolon ─────────────────────────────────────
        if (ch === ';') {
            return {
                token: { type: TokenType.SEMICOLON, value: ';', start: pos, end: pos + 1 },
                nextPos: pos + 1,
            };
        }
        // ── Background & ──────────────────────────────────
        if (ch === '&') {
            return {
                token: { type: TokenType.BACKGROUND, value: '&', start: pos, end: pos + 1 },
                nextPos: pos + 1,
            };
        }
        // ── Redirect > >> < << <<< >& ─────────────────────
        if (ch === '>' || ch === '<') {
            let end = pos + 1;
            if (input[end] === '>' || input[end] === ch)
                end++;
            if (input[end] === '&' && ch === '>')
                end++;
            return {
                token: { type: TokenType.REDIRECT, value: input.slice(pos, end), start: pos, end },
                nextPos: end,
            };
        }
        // ── Command substitution $(...) ────────────────────
        if (ch === '$' && input[pos + 1] === '(') {
            return this.parseDelimited(input, pos, '$(', ')', TokenType.COMMAND_SUBSTITUTION);
        }
        // ── Backtick substitution `...` ────────────────────
        if (ch === '`') {
            return this.parseDelimited(input, pos, '`', '`', TokenType.BACKTICK_SUBSTITUTION);
        }
        // ── Variable ${...} or $NAME ─────────────────────
        if (ch === '$') {
            if (input[pos + 1] === '{') {
                return this.parseDelimited(input, pos, '${', '}', TokenType.VARIABLE);
            }
            // Simple variable: $NAME, $1, $@, $?
            let end = pos + 1;
            if (/[A-Za-z0-9_?!@#*]/.test(input[end] || '')) {
                end++;
                while (end < input.length && /[A-Za-z0-9_]/.test(input[end]))
                    end++;
            }
            return {
                token: { type: TokenType.VARIABLE, value: input.slice(pos, end), start: pos, end },
                nextPos: end,
            };
        }
        // ── Subshell (...) ────────────────────────────────
        if (ch === '(') {
            return this.parseDelimited(input, pos, '(', ')', TokenType.SUBSHELL);
        }
        // ── Single-quoted string ──────────────────────────
        if (ch === "'") {
            const end = input.indexOf("'", pos + 1);
            if (end === -1) {
                // Unterminated — consume rest
                return {
                    token: { type: TokenType.STRING, value: input.slice(pos), start: pos, end: input.length },
                    nextPos: input.length,
                };
            }
            return {
                token: { type: TokenType.STRING, value: input.slice(pos, end + 1), start: pos, end: end + 1 },
                nextPos: end + 1,
            };
        }
        // ── Double-quoted string ──────────────────────────
        if (ch === '"') {
            const end = input.indexOf('"', pos + 1);
            if (end === -1) {
                return {
                    token: { type: TokenType.STRING, value: input.slice(pos), start: pos, end: input.length },
                    nextPos: input.length,
                };
            }
            return {
                token: { type: TokenType.STRING, value: input.slice(pos, end + 1), start: pos, end: end + 1 },
                nextPos: end + 1,
            };
        }
        // ── Word (unquoted command/argument) ──────────────
        let end = pos;
        while (end < input.length &&
            !/\s/.test(input[end]) &&
            !'|&;<>$`\'"()'.includes(input[end])) {
            end++;
        }
        if (end > pos) {
            return {
                token: { type: TokenType.WORD, value: input.slice(pos, end), start: pos, end },
                nextPos: end,
            };
        }
        // Consume unknown char
        return {
            token: { type: TokenType.WORD, value: ch, start: pos, end: pos + 1 },
            nextPos: pos + 1,
        };
    }
    /**
     * Parse a delimited token like $(...), ${...}, `...`, (...).
     * Recursively tokenizes inner content.
     */
    parseDelimited(input, pos, open, close, type) {
        let depth = 1;
        let index = pos + open.length;
        const start = pos;
        while (index < input.length && depth > 0) {
            if (input.slice(index, index + open.length) === open && type === TokenType.SUBSHELL) {
                depth++;
                index += open.length;
                continue;
            }
            if (input.slice(index, index + close.length) === close) {
                depth--;
                if (depth === 0) {
                    index += close.length;
                    break;
                }
            }
            index++;
        }
        const inner = input.slice(start + open.length, index - close.length);
        const innerAst = this.tokenize(inner);
        return {
            token: {
                type,
                value: input.slice(start, index),
                start,
                end: index,
                children: innerAst.commands.length > 0 ? innerAst.commands : undefined,
            },
            nextPos: index,
        };
    }
    /**
     * Analyze a token for risk.
     */
    analyzeRisk(tokens) {
        const risk = {
            hasCommandSubstitution: false,
            hasPipes: false,
            hasRedirects: false,
            hasLogicalChains: false,
            dangerousCommands: [],
            shellMetacharacters: [],
        };
        const walkTokens = (list) => {
            for (const token of list) {
                switch (token.type) {
                    case TokenType.COMMAND_SUBSTITUTION:
                    case TokenType.BACKTICK_SUBSTITUTION:
                        risk.hasCommandSubstitution = true;
                        if (token.children)
                            walkTokens(token.children);
                        break;
                    case TokenType.PIPE:
                        risk.hasPipes = true;
                        break;
                    case TokenType.REDIRECT:
                        risk.hasRedirects = true;
                        break;
                    case TokenType.AND_IF:
                    case TokenType.OR_IF:
                        risk.hasLogicalChains = true;
                        break;
                    case TokenType.WORD:
                        if (this.DANGEROUS_COMMANDS.has(token.value.toLowerCase())) {
                            if (!risk.dangerousCommands.includes(token.value)) {
                                risk.dangerousCommands.push(token.value);
                            }
                        }
                        break;
                    case TokenType.SUBSHELL:
                        risk.shellMetacharacters.push('(...)');
                        if (token.children)
                            walkTokens(token.children);
                        break;
                    case TokenType.VARIABLE:
                        risk.shellMetacharacters.push(token.value);
                        break;
                    default:
                        break;
                }
            }
        };
        walkTokens(tokens);
        return risk;
    }
    /** Netcat/ncat bind/exec reverse-shell flags in tool argument text. */
    detectNetcatReverseShell(input) {
        if (/\b(?:nc|ncat|netcat)\b[^\n]{0,80}\s+-e\b/i.test(input)) {
            return 'Netcat reverse/bind shell (-e) detected in arguments';
        }
        if (/\b(?:nc|ncat|netcat)\b[^\n]{0,40}\s+-e\s+\/bin\/(?:ba)?sh\b/i.test(input)) {
            return 'Netcat reverse shell to /bin/sh detected in arguments';
        }
        return null;
    }
    /** Detect PowerShell-specific execution patterns in raw argument text. */
    detectPowerShellRisk(input) {
        for (const pattern of this.POWERSHELL_DANGEROUS) {
            if (pattern.test(input)) {
                return `PowerShell dangerous pattern detected: ${pattern.source}`;
            }
        }
        return null;
    }
    SENSITIVE_READ_RE = /\b(?:cat|head|tail|less|strings|type|more|bat)\s+.*(?:\/etc\/passwd|~\/\.ssh|\.ssh\/|id_rsa|id_ed25519|\.env|\.aws\/|credentials|secrets?)/i;
    /**
     * Command substitution/backticks that read credential paths (e.g. $(cat /etc/passwd)).
     */
    detectSensitiveCommandSubstitution(input) {
        const patterns = [
            /\$\(\s*(?:cat|head|tail|less|strings|type)\s+[^)]*(?:\/etc\/passwd|~\/\.ssh|\.ssh\/|id_rsa|\.env)/i,
            /`[^`]*(?:cat|head|tail)\s+[^`]*(?:\/etc\/passwd|~\/\.ssh|id_rsa|\.env)[^`]*`/i,
            /\$\{[^}]*(?:cat|head|tail)[^}]*(?:passwd|\.ssh|\.env)/i,
        ];
        for (const re of patterns) {
            if (re.test(input)) {
                return 'Semantic: command substitution reads sensitive credential path';
            }
        }
        if (this.SENSITIVE_READ_RE.test(input)) {
            return 'Semantic: shell reads sensitive credential path';
        }
        return null;
    }
    /**
     * ADV-006: inter-letter whitespace obfuscation (e.g. `b a s h -c id`).
     */
    SPELLED_THREAT_WORDS = new Set([
        ...this.DANGEROUS_COMMANDS,
        'ignore',
        'disregard',
        'union',
        'select',
        'delete',
        'drop',
        'override',
        'bypass',
        'eval',
        'exec',
    ]);
    detectWhitespaceObfuscatedShell(input) {
        const re = /(?:[a-zA-Z]\s+){3,}[a-zA-Z](?=\s|$|[^a-zA-Z])/g;
        for (const match of input.matchAll(re)) {
            const spelled = match[0].replace(/\s+/g, '').toLowerCase();
            if (this.SPELLED_THREAT_WORDS.has(spelled)) {
                return `Whitespace-obfuscated token detected: ${spelled}`;
            }
        }
        const compact = input.replace(/\s+/g, '');
        if (/\brm-?rf\b/i.test(compact) ||
            /\bbase64\b/i.test(compact) ||
            /\bsh-c\b/i.test(compact) ||
            /\bnc-?e\b/i.test(compact)) {
            return 'Whitespace-obfuscated destructive shell pattern detected';
        }
        return null;
    }
    /** Detect base64-decode piped to shell (echo … | base64 -d | sh). */
    detectBase64PipeShell(input) {
        for (const pattern of this.BASE64_PIPE_SHELL) {
            if (pattern.test(input)) {
                return 'Base64 decode piped to shell detected';
            }
        }
        return null;
    }
    /**
     * Full semantic analysis: tokenize + assess risk.
     */
    analyze(input) {
        const ast = this.tokenize(input);
        const risk = this.analyzeRisk(ast.commands);
        const psReason = this.detectPowerShellRisk(input);
        if (psReason && !risk.dangerousCommands.includes('powershell-pattern')) {
            risk.dangerousCommands.push('powershell-pattern');
        }
        return { ast, risk };
    }
}
//# sourceMappingURL=shell-tokenizer.js.map