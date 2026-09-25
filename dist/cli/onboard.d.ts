import { type WrapClient } from '../wrap/client-wrap.js';
export interface OnboardArtifact {
    client: string;
    clientConfigPath: string;
    policy: string;
    servers: string[];
    configsDir: string;
    onboardedAt: string;
    applied: boolean;
}
export declare function readOnboardArtifact(): OnboardArtifact | null;
export declare function writeOnboardArtifact(data: OnboardArtifact): void;
export interface OnboardOptions {
    client: WrapClient;
    configPath?: string;
    policyPath: string;
    /** Package install root (dist/cli.js); defaults via resolveMastyfAiInstallRoot() */
    projectRoot?: string;
    /** Directory for mastyf-ai-configs/ (default: process.cwd()) */
    workspaceRoot?: string;
    apply: boolean;
    skipNames: string[];
    startProxy: boolean;
    /** Run `mastyf-ai start` after successful onboard */
    start?: boolean;
}
export declare function runOnboard(opts: OnboardOptions): OnboardArtifact;
export declare function runOnboardAndMaybeStart(opts: OnboardOptions): Promise<OnboardArtifact>;
//# sourceMappingURL=onboard.d.ts.map