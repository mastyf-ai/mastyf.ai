/**
 * Tool Result / Response Injection Scanner
 *
 * Scans content returned by external tools/APIs/databases to prevent
 * indirect prompt injections from hijacking the agent context.
 */
export interface ResultScanResult {
    injected: boolean;
    pattern?: string;
    matchedText?: string;
    confidence: number;
    threatCategory?: string;
}
/**
 * Extracts plain text strings recursively from tool result objects/arrays.
 */
export declare function extractTextContent(result: unknown): string;
/**
 * Scans a tool result for prompt injection patterns.
 */
export declare function scanToolResult(result: unknown): ResultScanResult;
//# sourceMappingURL=result-injection-scanner.d.ts.map