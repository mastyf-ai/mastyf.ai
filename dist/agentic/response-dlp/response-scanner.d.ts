/**
 * Response DLP Scanner — inspects MCP tool responses for data leaks.
 *
 * Detects:
 *   - PII (email, phone, SSN, credit card, addresses)
 *   - Credential exposure (API keys, tokens, passwords in responses)
 *   - Sensitive file paths (/.env, /etc/shadow, ~/.ssh/id_rsa)
 *   - Large base64 blobs (potential exfiltration)
 *   - Internal IP/hostname disclosure
 *
 * Unlike request-side policy, this inspects tool OUTPUTS before they
 * reach the AI agent — preventing data leaks from compromised tools.
 */
export interface DlpViolation {
    /** Category of violation */
    category: 'pii' | 'credential' | 'sensitive_path' | 'exfiltration' | 'internal_disclosure';
    /** Severity */
    severity: 'critical' | 'high' | 'medium' | 'low';
    /** What was found */
    finding: string;
    /** Sample (redacted) of the matched content */
    sampleRedacted: string;
    /** Whether to block this response */
    shouldBlock: boolean;
    /** Recommended action */
    action: 'block' | 'redact' | 'warn';
}
export interface DlpScanResult {
    /** Whether violations were found */
    violated: boolean;
    /** List of violations */
    violations: DlpViolation[];
    /** Whether the response should be blocked entirely */
    block: boolean;
    /** The response text with violations redacted (if not blocked) */
    redactedText?: string;
    /** Summary for logging */
    summary: string;
}
export declare class ResponseDlpScanner {
    private totalScans;
    private totalViolations;
    private totalBlocks;
    /**
     * Scan a tool response for data leaks.
     */
    scan(toolName: string, serverName: string, responseText: string): DlpScanResult;
    /** Scan for credential exposure. */
    private scanForCredentials;
    /** Scan for PII. */
    private scanForPii;
    /** Scan for sensitive file paths. */
    private scanForSensitivePaths;
    /** Scan for data exfiltration indicators. */
    private scanForExfiltration;
    /** Scan for internal network/hostname disclosure. */
    private scanForInternalDisclosure;
    /** Redact violations from text. */
    private redactText;
    /** Get scan statistics. */
    getStats(): {
        totalScans: number;
        totalViolations: number;
        totalBlocks: number;
        violationRate: number;
        blockRate: number;
    };
}
//# sourceMappingURL=response-scanner.d.ts.map