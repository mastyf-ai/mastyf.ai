export interface TokenInspectionResult {
    detected: boolean;
    category: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    evidence: string;
    confidence: number;
}
/** Recursive token inspection: walk all string leaves and inspect JWT/SAML. */
export declare function runTokenInspection(flat: {
    keyPath: string;
    value: string;
}[]): TokenInspectionResult[];
//# sourceMappingURL=token-inspector.d.ts.map