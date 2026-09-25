/**
 * Enterprise response DLP — output filtering for tool results (secrets, PII, exfil markers).
 * Modes: block (default), redact (scrub-and-pass), audit (detect only, never block).
 */
import { detectPromptInjection } from '../scanners/prompt-injection-detector.js';
import { scanForSecrets } from '../scanners/secret-scanner.js';
import { MAX_RESPONSE_DLP_BYTES, truncateForPolicy, utf8ByteLength } from '../utils/eval-bounds.js';
import { decodeResponseForInspection } from '../utils/response-decode.js';
export { decodeResponseForInspection } from '../utils/response-decode.js';
const PII_PATTERNS = [
    { id: 'pii-ssn', severity: 'high', category: 'pii', regex: /\b\d{3}-\d{2}-\d{4}\b/g, redactLabel: 'SSN' },
    {
        id: 'pii-credit-card',
        severity: 'high',
        category: 'pii',
        regex: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
        redactLabel: 'CARD',
    },
    {
        id: 'pii-phone',
        severity: 'medium',
        category: 'pii',
        regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
        redactLabel: 'PHONE',
    },
    {
        id: 'pii-e164',
        severity: 'medium',
        category: 'pii',
        regex: /\b\+[1-9]\d{7,14}\b/g,
        redactLabel: 'PHONE',
    },
    {
        id: 'pii-iban',
        severity: 'high',
        category: 'pii',
        regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
        redactLabel: 'IBAN',
    },
    {
        id: 'pii-npi',
        severity: 'high',
        category: 'pii',
        regex: /\b\d{10}\b(?=.*\b(?:npi|provider|healthcare|patient)\b)/gi,
        redactLabel: 'NPI',
    },
    {
        id: 'pii-icd10',
        severity: 'high',
        category: 'pii',
        regex: /\b(?:ICD(?:-10)?|diagnosis\s*code)\s*[:#]?\s*[A-TV-Z][0-9][0-9AB]\.?[0-9A-TV-Z]{0,4}\b/gi,
        redactLabel: 'ICD10',
    },
    {
        id: 'pii-icd10-standalone',
        severity: 'medium',
        category: 'pii',
        regex: /\b[A-TV-Z][0-9][0-9AB]\.[0-9A-TV-Z]{1,4}\b/g,
        redactLabel: 'ICD10',
    },
    {
        id: 'pii-ndc',
        severity: 'high',
        category: 'pii',
        regex: /\b(?:NDC|drug\s*code)\s*[:#]?\s*\d{4,5}-\d{3,4}-\d{1,2}\b/gi,
        redactLabel: 'NDC',
    },
    {
        id: 'pii-ndc-standalone',
        severity: 'medium',
        category: 'pii',
        regex: /\b\d{4,5}-\d{3,4}-\d{1,2}\b(?=.*\b(?:ndc|drug|rx|prescription|medication)\b)/gi,
        redactLabel: 'NDC',
    },
    {
        id: 'pii-diagnosis',
        severity: 'high',
        category: 'pii',
        regex: /\b(?:diagnosis|dx|assessment)\s*[:=]\s*[^\n,;]{3,120}/gi,
        redactLabel: 'DIAGNOSIS',
    },
    {
        id: 'pii-email-bulk',
        severity: 'medium',
        category: 'pii',
        regex: /(?:[\w.+-]+@[\w.-]+\.\w{2,}[\s,;]){5,}/gi,
        redactLabel: 'EMAIL',
    },
    {
        id: 'pii-passport',
        severity: 'high',
        category: 'pii',
        regex: /\b[A-Z]{1,2}\d{6,9}\b/g,
        redactLabel: 'ID',
    },
];
const SENSITIVE_CONTENT_MARKERS = [
    { id: 'content-passwd', severity: 'critical', category: 'sensitive-content', regex: /root:.*?:\/bin\//g, redactLabel: 'PASSWD' },
    { id: 'content-aws-key', severity: 'critical', category: 'sensitive-content', regex: /AKIA[0-9A-Z]{16}/g, redactLabel: 'AWS_KEY' },
    {
        id: 'content-private-key',
        severity: 'critical',
        category: 'sensitive-content',
        regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
        redactLabel: 'PRIVATE_KEY',
    },
    {
        id: 'content-connection-string',
        severity: 'high',
        category: 'sensitive-content',
        regex: /(?:postgres|mysql|mongodb)(?:\+srv)?:\/\/[^:]+:[^@\s]+@/gi,
        redactLabel: 'CONN_STRING',
    },
    {
        id: 'content-azure-sas',
        severity: 'critical',
        category: 'sensitive-content',
        regex: /[?&]sig=[A-Za-z0-9%+/=]{20,}/g,
        redactLabel: 'AZURE_SAS',
    },
    {
        id: 'content-gcp-sa-json',
        severity: 'critical',
        category: 'sensitive-content',
        regex: /"type"\s*:\s*"service_account"/g,
        redactLabel: 'GCP_SA',
    },
    {
        id: 'content-k8s-secret',
        severity: 'high',
        category: 'sensitive-content',
        regex: /kind:\s*Secret[\s\S]{0,200}?data:\s*\n/gi,
        redactLabel: 'K8S_SECRET',
    },
    {
        id: 'content-jwt',
        severity: 'high',
        category: 'sensitive-content',
        regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        redactLabel: 'JWT',
    },
    {
        id: 'content-phi-marker',
        severity: 'high',
        category: 'pii',
        regex: /\b(?:MRN|patient\s*id|medical\s*record|diagnosis|HIPAA|ICD(?:-10)?|NDC)\s*[:=]\s*\S+/gi,
        redactLabel: 'PHI',
    },
];
const RESPONSE_EXFIL_PATTERNS = [
    /\b(?:curl|wget|fetch)\b.*\bhttps?:\/\/[^\s"']+/i,
    /\$\(\s*(?:cat|head|tail)\s+.*(?:\.env|credentials|id_rsa)/i,
    /\b(?:send|post|upload|transmit)\b.*\b(?:secret|password|credential|api[_-]?key)/i,
];
export function getResponseDlpMode() {
    const raw = (process.env['MASTYF_AI_RESPONSE_DLP_MODE'] || 'block').toLowerCase();
    if (raw === 'redact' || raw === 'audit')
        return raw;
    return 'block';
}
function collectPatternFindings(text, patterns) {
    const out = [];
    for (const { id, severity, category, regex } of patterns) {
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(text)) !== null) {
            out.push({
                category,
                severity,
                ruleId: id,
                message: `${category} pattern ${id} in tool response`,
                start: m.index,
                end: m.index + m[0].length,
            });
            if (!regex.global)
                break;
        }
    }
    return out;
}
/** Context-aware: redact value after password:/api_key:/secret: labels. */
const LABELED_SECRET_RE = /\b((?:password|passwd|api[_-]?key|secret|token|credential)s?)\s*[:=]\s*(\S+)/gi;
function redactLabeledSecrets(text) {
    const reasons = [];
    const out = text.replace(LABELED_SECRET_RE, (_full, label) => {
        reasons.push(`labeled-secret:${String(label).toLowerCase()}`);
        return `${label}: [REDACTED]`;
    });
    return { text: out, reasons };
}
function redactSpans(text, findings) {
    const spans = findings
        .filter((f) => f.start != null && f.end != null && f.end > f.start)
        .sort((a, b) => (b.start - a.start));
    let out = text;
    for (const f of spans) {
        const label = f.ruleId.replace(/^[^-]+-/, '').toUpperCase().slice(0, 12);
        out = out.slice(0, f.start) + `[REDACTED:${label}]` + out.slice(f.end);
    }
    return out;
}
function buildRedactionReasons(findings, extra = []) {
    const fromFindings = findings.slice(0, 8).map((f) => `${f.category}:${f.ruleId}`);
    return [...new Set([...extra, ...fromFindings])];
}
/**
 * Full response DLP scan — used by PolicyEngine.evaluateResponse and streaming inspector.
 */
export function evaluateResponseDlp(toolName, serverName, responseBody) {
    const mode = getResponseDlpMode();
    if (responseBody == null || typeof responseBody !== 'string') {
        return {
            clean: true,
            findings: [],
            hasCritical: false,
            hasHigh: false,
            truncated: false,
            scannedBytes: 0,
            mode,
        };
    }
    let truncated = false;
    let body = responseBody;
    if (utf8ByteLength(body) > MAX_RESPONSE_DLP_BYTES) {
        const ratio = MAX_RESPONSE_DLP_BYTES / utf8ByteLength(body);
        body = body.slice(0, Math.floor(body.length * ratio));
        truncated = true;
    }
    const { text: scanText, truncated: charTrunc } = truncateForPolicy(body, MAX_RESPONSE_DLP_BYTES);
    truncated = truncated || charTrunc;
    const decoded = decodeResponseForInspection(scanText, { unicodeStrict: true });
    const inspectText = decoded.text;
    const findings = [];
    const ctx = `response:${serverName}:${toolName}`;
    for (const f of detectPromptInjection(toolName, inspectText)) {
        const sev = f.severity === 'critical' ? 'critical' : f.severity === 'high' ? 'high' : 'medium';
        findings.push({
            category: 'injection',
            severity: sev,
            ruleId: f.patternId,
            message: `Prompt injection in response (${f.severity}): ${f.description}`,
        });
    }
    for (const f of scanForSecrets(inspectText, ctx)) {
        const sev = f.severity === 'HIGH' ? 'high' : 'medium';
        findings.push({
            category: 'secret',
            severity: sev,
            ruleId: f.type,
            message: `Secret (${f.severity}): ${f.type} in tool response`,
            start: f.start,
            end: f.end,
        });
    }
    findings.push(...collectPatternFindings(inspectText, PII_PATTERNS));
    findings.push(...collectPatternFindings(inspectText, SENSITIVE_CONTENT_MARKERS));
    for (const pattern of RESPONSE_EXFIL_PATTERNS) {
        if (pattern.test(inspectText)) {
            findings.push({
                category: 'exfil',
                severity: 'high',
                ruleId: 'response-exfil-pattern',
                message: `Data exfiltration marker in response: ${pattern.source.slice(0, 60)}`,
            });
            break;
        }
    }
    const b64chunks = [...inspectText.matchAll(/[A-Za-z0-9+/]{100,}={0,2}/g)];
    for (const chunk of b64chunks.slice(0, 8)) {
        try {
            const decoded = Buffer.from(chunk[0], 'base64').toString('utf-8');
            if (/\b(bash|sh|cmd|powershell|eval|exec|curl|wget)\b/.test(decoded)) {
                findings.push({
                    category: 'exfil',
                    severity: 'high',
                    ruleId: 'response-b64-shell',
                    message: 'Base64-encoded shell command in response',
                });
                break;
            }
        }
        catch {
            /* ignore */
        }
    }
    const hasCritical = findings.some((f) => f.severity === 'critical');
    const hasHigh = findings.some((f) => f.severity === 'high');
    let redactedBody;
    const redactionReasons = [];
    if (mode === 'redact') {
        let working = inspectText;
        const labeled = redactLabeledSecrets(working);
        working = labeled.text;
        redactionReasons.push(...labeled.reasons);
        if (findings.length > 0) {
            working = redactSpans(working, findings);
            redactionReasons.push(...buildRedactionReasons(findings));
        }
        if (labeled.reasons.length > 0 || findings.length > 0) {
            redactedBody = working;
        }
    }
    return {
        clean: findings.length === 0,
        findings,
        hasCritical,
        hasHigh,
        truncated,
        scannedBytes: utf8ByteLength(inspectText),
        redactedBody,
        mode,
        redactionReasons: redactionReasons.length ? redactionReasons : undefined,
        decodePasses: decoded.passes.length ? decoded.passes : undefined,
    };
}
export function responseDlpToLegacyDetections(result) {
    return result.findings.map((f) => f.message);
}
/** Whether response DLP should block forwarding (respects audit/redact modes). */
export function shouldBlockResponseDlp(result) {
    if (result.mode === 'audit' || result.mode === 'redact')
        return false;
    return result.hasCritical || result.hasHigh;
}
//# sourceMappingURL=response-dlp.js.map