import { type OnboardingStatus } from './server-registry.js';
export type MastyfAiSetupConfig = {
    upstreamUrl?: string;
    listenPort?: number;
    authToken?: string;
    updatedAt?: string;
};
export type SetupMastyfAiConfigView = {
    upstreamUrl: string;
    listenPort: number;
    authTokenPreview: string | null;
    configured: boolean;
    done: boolean;
};
export type SetupDatabaseHealth = {
    done: boolean;
    engine: string;
    version: string;
    latencyMs: number | null;
    error?: string;
};
export type SetupProxyTraffic = {
    done: boolean;
    totalCalls: number;
    healthy: boolean;
};
export type SetupCloudView = {
    connected: boolean;
    controlPlaneUrl: string | null;
    ssoEnabled: boolean;
    policyStrictnessPct: number;
    apiKeyRotationEnabled: boolean;
};
export type SetupStatusPayload = {
    available: boolean;
    completedCount: number;
    totalSteps: number;
    mastyfAiConfig: SetupMastyfAiConfigView;
    database: SetupDatabaseHealth;
    proxyTraffic: SetupProxyTraffic;
    cloud: SetupCloudView;
    onboarding: OnboardingStatus;
};
export declare function writeSetupFile(patch: MastyfAiSetupConfig): MastyfAiSetupConfig;
export declare function probeDatabaseHealth(): Promise<SetupDatabaseHealth>;
export declare function readCloudSetup(): SetupCloudView;
export declare function buildSetupStatus(projectRoot?: string): Promise<SetupStatusPayload>;
export declare function connectCloudSetup(body: {
    controlPlaneUrl: string;
    ssoEnabled?: boolean;
    policyStrictnessPct?: number;
    apiKeyRotationEnabled?: boolean;
}): {
    ok: boolean;
    launchUrl: string;
};
//# sourceMappingURL=setup-status.d.ts.map