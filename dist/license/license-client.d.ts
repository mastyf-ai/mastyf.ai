export type LicenseState = {
    licensed: boolean;
    tenantSlug: string;
    orgId?: string;
    orgName?: string;
    status: string;
    features: string[];
    expiresAt: string | null;
    graceUntil: string | null;
    cloudBillingUrl: string;
    checkedAt: number;
};
export type LicenseClientConfig = {
    controlPlaneUrl?: string;
    licenseKey?: string;
    requireLicense: boolean;
    refreshSeconds: number;
    graceSeconds: number;
    fetchFn?: typeof fetch;
    offlineLicenseKey?: string;
    offlinePublicKey?: string;
    machineId?: string;
};
export declare function isCloudLicenseKey(key: string): boolean;
export declare function loadLicenseClientConfig(): LicenseClientConfig;
export declare function isLicenseEnforcementEnabled(): boolean;
export declare function getLicenseClient(): LicenseClient;
export declare function resetLicenseClientForTests(): void;
type LicenseChangeListener = (state: LicenseState | null) => void;
export declare class LicenseClient {
    private config;
    private state;
    private lastGoodState;
    private refreshTimer;
    private listeners;
    private fetchFn;
    constructor(config: LicenseClientConfig);
    onChange(listener: LicenseChangeListener): () => void;
    private notify;
    getState(): LicenseState | null;
    isLicensed(): boolean;
    getTier(): 'community' | 'pro';
    hasFeature(_feature: string): boolean;
    getTenantSlug(): string | undefined;
    getCloudBillingUrl(): string | undefined;
    isEnabled(): boolean;
    hasOfflineLicense(): boolean;
    applyLemonLicense(): boolean;
    applyOfflineLicense(): boolean;
    requiresLicense(): boolean;
    matchesLicenseKey(key: string): boolean;
    private isWithinGrace;
    refresh(): Promise<LicenseState | null>;
    private applyFailedCheck;
    start(): Promise<boolean>;
    stop(): void;
    exchangeCloudToken(token: string): Promise<{
        sessionToken: string;
        tenantSlug: string;
        features: string[];
        cloudBillingUrl: string;
    } | null>;
}
export {};
//# sourceMappingURL=license-client.d.ts.map