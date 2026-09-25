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
export declare enum TokenType {
    WORD = "WORD",
    STRING = "STRING",
    VARIABLE = "VARIABLE",
    COMMAND_SUBSTITUTION = "COMMAND_SUBSTITUTION",
    BACKTICK_SUBSTITUTION = "BACKTICK_SUBSTITUTION",
    PIPE = "PIPE",
    REDIRECT = "REDIRECT",
    SEMICOLON = "SEMICOLON",
    AND_IF = "AND_IF",// &&
    OR_IF = "OR_IF",// ||
    BACKGROUND = "BACKGROUND",
    SUBSHELL = "SUBSHELL"
}
export interface Token {
    type: TokenType;
    value: string;
    /** Start position in original string */
    start: number;
    /** End position in original string */
    end: number;
    /** For compound tokens (substitution, subshell), nested tokens */
    children?: Token[];
}
export interface ShellAST {
    /** Top-level commands (separated by ;, &&, ||, &) */
    commands: Token[];
    /** Whether the input contained potentially dangerous constructs */
    warnings: string[];
}
/**
 * Dangerous command categories for semantic analysis.
 */
export interface CommandRisk {
    /** High risk: command substitution present */
    hasCommandSubstitution: boolean;
    /** High risk: pipe chains present */
    hasPipes: boolean;
    /** Medium risk: redirect operators present */
    hasRedirects: boolean;
    /** Medium risk: logical chain operators */
    hasLogicalChains: boolean;
    /** Dangerous commands detected in tokenized words */
    dangerousCommands: string[];
    /** Shell metacharacters found */
    shellMetacharacters: string[];
}
/**
 * ShellTokenizer parses shell-like input into an AST without executing anything.
 * It's a security analyzer, not a full POSIX shell parser — focus is on detecting
 * execution patterns that signal malicious intent.
 */
export declare class ShellTokenizer {
    private readonly DANGEROUS_COMMANDS;
    private readonly BASE64_PIPE_SHELL;
    /** PowerShell-specific dangerous patterns (checked on full input string). */
    private readonly POWERSHELL_DANGEROUS;
    /**
     * Tokenize a string that may contain shell syntax.
     */
    tokenize(input: string): ShellAST;
    /**
     * Parse the next token starting at position pos.
     */
    private nextToken;
    /**
     * Parse a delimited token like $(...), ${...}, `...`, (...).
     * Recursively tokenizes inner content.
     */
    private parseDelimited;
    /**
     * Analyze a token for risk.
     */
    analyzeRisk(tokens: Token[]): CommandRisk;
    /** Netcat/ncat bind/exec reverse-shell flags in tool argument text. */
    detectNetcatReverseShell(input: string): string | null;
    /** Detect PowerShell-specific execution patterns in raw argument text. */
    detectPowerShellRisk(input: string): string | null;
    private readonly SENSITIVE_READ_RE;
    /**
     * Command substitution/backticks that read credential paths (e.g. $(cat /etc/passwd)).
     */
    detectSensitiveCommandSubstitution(input: string): string | null;
    /**
     * ADV-006: inter-letter whitespace obfuscation (e.g. `b a s h -c id`).
     */
    private readonly SPELLED_THREAT_WORDS;
    detectWhitespaceObfuscatedShell(input: string): string | null;
    /** Detect base64-decode piped to shell (echo … | base64 -d | sh). */
    detectBase64PipeShell(input: string): string | null;
    /**
     * Full semantic analysis: tokenize + assess risk.
     */
    analyze(input: string): {
        ast: ShellAST;
        risk: CommandRisk;
    };
}
//# sourceMappingURL=shell-tokenizer.d.ts.map