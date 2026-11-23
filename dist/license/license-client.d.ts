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
    /** Whether the workspace is on a paid plan. Absent from older control planes, which reads as no. */
    paid?: boolean;
    tier?: string;
};
export type LicenseClientConfig = {
    controlPlaneUrl?: string;
    licenseKey?: string;
    requireLicense: boolean;
    refreshSeconds: number;
    graceSeconds: number;
    fetchFn?: typeof fetch;
};
export declare function isCloudLicenseKey(key: string): boolean;
export declare function loadLicenseClientConfig(): LicenseClientConfig;
export declare function isLicenseEnforcementEnabled(): boolean;
export declare function getLicenseClient(): LicenseClient;
/** There is deliberately no setting that does this outside a test. */
export declare function setPaidPlanForTests(paid: boolean | null): void;
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
    /**
     * Only the control plane's answer counts; the bypass settings above don't apply. An outage never
     * removes protection from a running proxy, so the last answer stands until the control plane gives
     * a new one. Only a clear answer (not paid, or a rejected key) turns the paid layers off.
     */
    hasPaidPlan(): boolean;
    /**
     * Over plain HTTP, anyone on the network could answer "not paid" and turn a customer's protection
     * off, so the plan is only read over HTTPS or from this machine.
     */
    controlPlaneIsSecure(): boolean;
    controlPlaneUnreachable(): boolean;
    getTenantSlug(): string | undefined;
    getCloudBillingUrl(): string | undefined;
    isEnabled(): boolean;
    requiresLicense(): boolean;
    matchesLicenseKey(key: string): boolean;
    private isWithinGrace;
    refresh(): Promise<LicenseState | null>;
    private fetchState;
    private applyFailedCheck;
    start(): Promise<boolean>;
    stop(): void;
    /**
     * Redeems a "Launch dashboard" token with the control plane, authenticated by this
     * workspace's API key. The cloud returns who is signing in directly over this HTTPS call,
     * so no cloud secret has to live on this host. `session` is absent from older control
     * planes, which sent an HMAC-signed `sessionToken` instead.
     */
    exchangeCloudToken(token: string): Promise<CloudExchangeResult | null>;
}
export type CloudExchangeResult = {
    session?: {
        tenantSlug: string;
        identity: string;
        roles: string[];
        exp: number;
    };
    /** Legacy control planes only. */
    sessionToken?: string;
    tenantSlug: string;
    features: string[];
    cloudBillingUrl: string;
};
/** The workspace API key this proxy uses with the control plane (as control-plane-client does). */
export declare function cloudApiKey(env?: NodeJS.ProcessEnv): string | null;
export {};
//# sourceMappingURL=license-client.d.ts.map