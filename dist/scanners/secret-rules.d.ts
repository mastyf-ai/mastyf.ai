export interface SecretRule {
    id: string;
    provider: string;
    severity: 'HIGH' | 'MEDIUM';
    regex: string;
    flags: string;
    entropy?: number;
    falsePositiveExclusions?: string[];
}
export declare const SECRET_RULES: SecretRule[];
//# sourceMappingURL=secret-rules.d.ts.map