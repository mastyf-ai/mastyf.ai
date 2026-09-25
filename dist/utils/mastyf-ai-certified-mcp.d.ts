export interface MastyfAiCertificationStatus {
    certified: boolean;
    level: 'none' | 'bronze' | 'silver' | 'gold';
    checks: Array<{
        name: string;
        passed: boolean;
        detail: string;
    }>;
    issuedAt: string;
}
export declare function evaluateMastyfAiCertification(repoRoot: string): MastyfAiCertificationStatus;
export declare function buildPartnerSignalFeed(repoRoot: string): {
    generatedAt: string;
    certification: MastyfAiCertificationStatus;
    signals: Array<{
        key: string;
        value: string | number | boolean;
    }>;
};
//# sourceMappingURL=mastyf-ai-certified-mcp.d.ts.map