export interface FederatedPrivacyConfig {
    epsilon: number;
    minReports: number;
}
export declare function federatedPrivacyConfig(): FederatedPrivacyConfig;
/** Laplace noise scaled by privacy budget ε (lower ε → more noise). */
export declare function applyDifferentialPrivacyNoise(value: number, epsilon: number): number;
export declare function hashFederatedSignature(payload: string): string;
export declare function shouldShareFederatedDelta(params: {
    sampleCount: number;
    epsilon: number;
    minReports: number;
}): {
    share: boolean;
    privacyBudgetEpsilon: number;
    reason: string;
};
//# sourceMappingURL=federated-privacy.d.ts.map