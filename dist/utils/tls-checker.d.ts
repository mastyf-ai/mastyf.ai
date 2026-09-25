export interface TlsCheckResult {
    valid: boolean;
    daysUntilExpiry: number;
    issuer?: string;
    subject?: string;
    protocol?: string;
}
/**
 * Check TLS certificate validity for a given HTTPS URL.
 * Returns validity status, days until expiry, and certificate details.
 */
export declare function checkTlsCert(url: string): Promise<TlsCheckResult>;
//# sourceMappingURL=tls-checker.d.ts.map