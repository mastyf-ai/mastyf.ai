/**
 * Comprehensive runtime argument scanner — catches attacks embedded in tool
 * call arguments that definition-only scan layers miss.
 *
 * Covers the full adversarial test harness gap (56% → ~12% false negative rate):
 *   - SQL/NoSQL injection (MCPG-A-SQL-*, MCPG-A-NSQL-*)
 *   - Boundary / null-byte evasion (MCPG-A-BND-*)
 *   - Credential/secret exfiltration (MCPG-A-CRED-*)
 *   - Shell obfuscation & injection (MCPG-A-SHELL-*)
 *   - Context injection / template breakout (MCPG-A-CTX-*)
 *   - Polyglot / encoding cascades (MCPG-A-POLY-*)
 *   - SSRF / URL manipulation (MCPG-A-SSRF-*)
 *   - Obfuscation / homoglyph chains (MCPG-A-OBF-*)
 *   - Command injection variants (MCPG-A-CMD-*)
 *   - XML / XXE / XPath / LDAP injection (MCPG-A-XML-*, MCPG-A-LDAP-*, MCPG-A-XPATH-*)
 *   - Deserialization attacks (MCPG-A-DSER-*)
 *   - ReDoS / regex bombing (MCPG-A-REDOS-*)
 *   - Dangerous JS patterns (MCPG-A-JS-*)
 *   - File inclusion / traversal (MCPG-A-FI-*)
 *   - Log injection / forging (MCPG-A-LOG-*)
 *   - Prompt injection in argument values (MCPG-A-PI-*)
 */
import type { Issue } from './types.js';
export interface ArgumentScanResult {
    issues: Issue[];
    addedLayers: {
        argument: {
            ran: boolean;
            durationMs: number;
        };
    };
}
export declare function runArgumentScan(args: Record<string, unknown> | undefined, toolName: string): ArgumentScanResult;
/** All scanner regexes — for ReDoS safety audit tests. */
export declare function getArgumentScannerPatterns(): RegExp[];
//# sourceMappingURL=argument-scanner.d.ts.map