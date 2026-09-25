export interface ServerRegistryEntry {
    name: string;
    configPath: string;
    transport: string;
    command?: string;
    wrapped: boolean;
    metrics?: {
        totalCalls: number;
        blocked: number;
        passed: number;
        lastSeen: string | null;
        topTools: Array<{
            tool: string;
            count: number;
        }>;
    };
}
export interface OnboardingStatus {
    onboarded: boolean;
    onboardedAt: string | null;
    client: string | null;
    wrapApplied: boolean;
    configsDir: string | null;
    configCount: number;
    hasTraffic: boolean;
    totalCalls: number;
    lastAnalysisAt: string | null;
    lastAnalysisState: string | null;
    dbPath: string;
    commands: {
        onboard: string;
        dashboardProxy: string;
        runAnalysis: string;
    };
}
export declare function getServerRegistry(projectRoot?: string): Promise<ServerRegistryEntry[]>;
export declare function getOnboardingStatus(projectRoot?: string): Promise<OnboardingStatus>;
//# sourceMappingURL=server-registry.d.ts.map