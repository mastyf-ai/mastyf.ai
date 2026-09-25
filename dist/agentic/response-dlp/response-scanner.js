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
/** Pre-compiled DLP patterns */
const DLP_PATTERNS = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    creditCard: /\b(?:\d[ -]*?){13,16}\b/g,
    phone: /\b(?:\+?1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g,
    apiKey: /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[a-zA-Z0-9-]+|AKIA[0-9A-Z]{16}|Bearer\s+[a-zA-Z0-9._~+/-]+=*)/g,
    password: /(?:password|passwd|pwd|secret)\s*[:=]\s*['\"]?\S+['\"]?/gi,
    token: /(?:api[_-]?key|auth[_-]?token|access[_-]?token)\s*[:=]\s*['\"]?\S+['\"]?/gi,
    sensitivePath: /(?:\/etc\/(?:passwd|shadow|group|sudoers)|~\/\.ssh\/id_rsa|~\/\.aws\/credentials|\.env(?:\.local|\.production)?|\.npmrc|\.git[_-]?credentials)/g,
    internalIp: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    hostname: /\b(?:staging|production|prod|dev|internal|private)\.\S+\.(?:internal|local|corp|lan)\b/gi,
    base64Blob: /(?:[A-Za-z0-9+/]{200,}={0,2})/g,
    jwt: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    dbUrl: /(?:postgres(?:ql)?|mysql|mongodb|redis|jdbc):\/\/[^\s'"]+/gi,
};
export class ResponseDlpScanner {
    totalScans = 0;
    totalViolations = 0;
    totalBlocks = 0;
    /**
     * Scan a tool response for data leaks.
     */
    scan(toolName, serverName, responseText) {
        this.totalScans++;
        const violations = [];
        // 1. Scan for credentials
        const credViolations = this.scanForCredentials(responseText);
        violations.push(...credViolations);
        // 2. Scan for PII
        const piiViolations = this.scanForPii(responseText);
        violations.push(...piiViolations);
        // 3. Scan for sensitive paths
        const pathViolations = this.scanForSensitivePaths(responseText);
        violations.push(...pathViolations);
        // 4. Scan for exfiltration indicators
        const exfilViolations = this.scanForExfiltration(responseText);
        violations.push(...exfilViolations);
        // 5. Scan for internal disclosure
        const internalViolations = this.scanForInternalDisclosure(responseText);
        violations.push(...internalViolations);
        // Decide whether to block
        const hasCritical = violations.some(v => v.severity === 'critical');
        const hasHigh = violations.some(v => v.severity === 'high');
        const block = hasCritical || hasHigh;
        if (violations.length > 0) {
            this.totalViolations++;
            if (block)
                this.totalBlocks++;
        }
        // Redact if not blocking
        let redactedText;
        if (violations.length > 0 && !block) {
            redactedText = this.redactText(responseText, violations);
        }
        return {
            violated: violations.length > 0,
            violations,
            block,
            redactedText: block ? undefined : redactedText,
            summary: violations.length > 0
                ? `DLP: ${violations.length} violation(s) in ${toolName} response — ${block ? 'BLOCKED' : violations.map(v => v.category).join(', ')}`
                : `DLP: Clean — no violations in ${toolName} response`,
        };
    }
    /** Scan for credential exposure. */
    scanForCredentials(text) {
        const violations = [];
        // API keys
        const apiKeys = text.match(DLP_PATTERNS.apiKey);
        if (apiKeys) {
            violations.push({
                category: 'credential',
                severity: 'critical',
                finding: `API key/token exposed in response (${apiKeys.length} match(es))`,
                sampleRedacted: apiKeys.slice(0, 3).map(k => k.slice(0, 8) + '...').join(', '),
                shouldBlock: true,
                action: 'block',
            });
        }
        // Passwords
        const passwords = text.match(DLP_PATTERNS.password);
        if (passwords) {
            violations.push({
                category: 'credential',
                severity: 'critical',
                finding: `Password/secret exposed in response`,
                sampleRedacted: passwords.slice(0, 2).map(p => p.replace(/[:=]\s*\S+/, ':***REDACTED***')).join(', '),
                shouldBlock: true,
                action: 'block',
            });
        }
        // Tokens
        const tokens = text.match(DLP_PATTERNS.token);
        if (tokens && !apiKeys) {
            violations.push({
                category: 'credential',
                severity: 'high',
                finding: `Auth token exposed in response`,
                sampleRedacted: tokens.slice(0, 2).join(', '),
                shouldBlock: true,
                action: 'block',
            });
        }
        // JWTs
        const jwts = text.match(DLP_PATTERNS.jwt);
        if (jwts) {
            violations.push({
                category: 'credential',
                severity: 'high',
                finding: `JWT token exposed in response`,
                sampleRedacted: jwts[0].slice(0, 40) + '...',
                shouldBlock: true,
                action: 'block',
            });
        }
        // Database URLs
        const dbUrls = text.match(DLP_PATTERNS.dbUrl);
        if (dbUrls) {
            violations.push({
                category: 'credential',
                severity: 'critical',
                finding: `Database connection string exposed (credentials may be embedded)`,
                sampleRedacted: dbUrls[0].replace(/\/\/[^@]+@/, '//***REDACTED***@'),
                shouldBlock: true,
                action: 'block',
            });
        }
        return violations;
    }
    /** Scan for PII. */
    scanForPii(text) {
        const violations = [];
        // Email
        const emails = text.match(DLP_PATTERNS.email);
        if (emails && emails.length > 2) {
            violations.push({
                category: 'pii',
                severity: 'medium',
                finding: `${emails.length} email addresses exposed in response`,
                sampleRedacted: emails.slice(0, 3).join(', '),
                shouldBlock: false,
                action: 'warn',
            });
        }
        // SSN
        const ssns = text.match(DLP_PATTERNS.ssn);
        if (ssns) {
            violations.push({
                category: 'pii',
                severity: 'high',
                finding: `SSN(s) exposed in response`,
                sampleRedacted: ssns[0].replace(/\d{3}-\d{2}/, '***-**'),
                shouldBlock: true,
                action: 'block',
            });
        }
        // Credit cards
        const ccs = text.match(DLP_PATTERNS.creditCard);
        if (ccs) {
            // Validate with Luhn algorithm
            const valid = ccs.filter(c => {
                const digits = c.replace(/\D/g, '');
                if (digits.length < 13 || digits.length > 16)
                    return false;
                const nums = digits.split('').reverse().map(Number);
                const sum = nums.reduce((s, n, i) => i % 2 === 0 ? s + n : s + (n * 2 > 9 ? n * 2 - 9 : n * 2), 0);
                return sum % 10 === 0;
            });
            if (valid.length > 0) {
                violations.push({
                    category: 'pii',
                    severity: 'critical',
                    finding: `Credit card number(s) exposed in response`,
                    sampleRedacted: valid[0].replace(/\d{12}(\d{4})/, '************$1'),
                    shouldBlock: true,
                    action: 'block',
                });
            }
        }
        return violations;
    }
    /** Scan for sensitive file paths. */
    scanForSensitivePaths(text) {
        const paths = text.match(DLP_PATTERNS.sensitivePath);
        if (paths) {
            return [{
                    category: 'sensitive_path',
                    severity: 'high',
                    finding: `Sensitive file path(s) exposed: ${paths.join(', ')}`,
                    sampleRedacted: paths.join(', '),
                    shouldBlock: true,
                    action: 'block',
                }];
        }
        return [];
    }
    /** Scan for data exfiltration indicators. */
    scanForExfiltration(text) {
        const violations = [];
        // Large base64 blobs (potential compressed/encoded data exfiltration)
        const blobs = text.match(DLP_PATTERNS.base64Blob);
        if (blobs && blobs.length > 3) {
            violations.push({
                category: 'exfiltration',
                severity: 'medium',
                finding: `${blobs.length} large base64 blobs in response — potential data exfiltration`,
                sampleRedacted: `${blobs.length} blobs totaling ~${blobs.reduce((s, b) => s + b.length, 0)} chars`,
                shouldBlock: false,
                action: 'warn',
            });
        }
        return violations;
    }
    /** Scan for internal network/hostname disclosure. */
    scanForInternalDisclosure(text) {
        const violations = [];
        // Internal IPs
        const ips = text.match(DLP_PATTERNS.internalIp);
        if (ips) {
            violations.push({
                category: 'internal_disclosure',
                severity: 'medium',
                finding: `Internal IP address(es) disclosed: ${[...new Set(ips)].join(', ')}`,
                sampleRedacted: [...new Set(ips)].join(', '),
                shouldBlock: false,
                action: 'warn',
            });
        }
        // Internal hostnames
        const hosts = text.match(DLP_PATTERNS.hostname);
        if (hosts) {
            violations.push({
                category: 'internal_disclosure',
                severity: 'low',
                finding: `Internal hostname(s) disclosed: ${[...new Set(hosts)].join(', ')}`,
                sampleRedacted: [...new Set(hosts)].join(', '),
                shouldBlock: false,
                action: 'warn',
            });
        }
        return violations;
    }
    /** Redact violations from text. */
    redactText(text, violations) {
        let result = text;
        for (const v of violations) {
            // Redact API keys
            result = result.replace(DLP_PATTERNS.apiKey, '***REDACTED-KEY***');
            // Redact passwords
            result = result.replace(DLP_PATTERNS.password, (match) => {
                const parts = match.split(/[:=]/);
                if (parts.length >= 2)
                    return `${parts[0]}: ***REDACTED***`;
                return '***REDACTED***';
            });
            // Redact tokens
            result = result.replace(DLP_PATTERNS.token, '***REDACTED-TOKEN***');
            // Redact JWTs
            result = result.replace(DLP_PATTERNS.jwt, '***REDACTED-JWT***');
            // Redact DB URLs
            result = result.replace(DLP_PATTERNS.dbUrl, '***REDACTED-DB-URL***');
            // Redact SSNs
            result = result.replace(DLP_PATTERNS.ssn, '***REDACTED-SSN***');
            // Redact credit cards
            result = result.replace(DLP_PATTERNS.creditCard, '***REDACTED-CC***');
            // Redact email (replace domain)
            result = result.replace(DLP_PATTERNS.email, '***REDACTED-EMAIL***');
        }
        return result;
    }
    /** Get scan statistics. */
    getStats() {
        return {
            totalScans: this.totalScans,
            totalViolations: this.totalViolations,
            totalBlocks: this.totalBlocks,
            violationRate: this.totalScans > 0 ? Math.round((this.totalViolations / this.totalScans) * 10000) / 100 : 0,
            blockRate: this.totalScans > 0 ? Math.round((this.totalBlocks / this.totalScans) * 10000) / 100 : 0,
        };
    }
}
//# sourceMappingURL=response-scanner.js.map