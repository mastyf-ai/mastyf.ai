export { decodeResponseForInspection } from '../utils/response-decode.js';
export type DlpSeverity = 'critical' | 'high' | 'medium' | 'low';
export type ResponseDlpMode = 'block' | 'redact' | 'audit';
export interface ResponseDlpFinding {
    category: 'secret' | 'pii' | 'injection' | 'exfil' | 'sensitive-content';
    severity: DlpSeverity;
    ruleId: string;
    message: string;
    /** Match span in scanned text (for redaction). */
    start?: number;
    end?: number;
}
export interface ResponseDlpResult {
    clean: boolean;
    findings: ResponseDlpFinding[];
    hasCritical: boolean;
    hasHigh: boolean;
    truncated: boolean;
    scannedBytes: number;
    redactedBody?: string;
    mode: ResponseDlpMode;
    /** Human-readable redaction reasons for clients / headers. */
    redactionReasons?: string[];
    decodePasses?: string[];
}
export declare function getResponseDlpMode(): ResponseDlpMode;
/**
 * Full response DLP scan — used by PolicyEngine.evaluateResponse and streaming inspector.
 */
export declare function evaluateResponseDlp(toolName: string, serverName: string, responseBody: string | null | undefined): ResponseDlpResult;
export declare function responseDlpToLegacyDetections(result: ResponseDlpResult): string[];
/** Whether response DLP should block forwarding (respects audit/redact modes). */
export declare function shouldBlockResponseDlp(result: ResponseDlpResult): boolean;
//# sourceMappingURL=response-dlp.d.ts.map