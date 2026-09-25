export type AutopilotReportSchedule = 'off' | 'daily' | 'weekly';
export type AutopilotConfig = {
    version: 1;
    enabled: boolean;
    tenantId: string;
    initializedAt: string;
    reportSchedule: AutopilotReportSchedule;
    reportCronHour: number;
    policyPath: string;
    blockingMode: 'block' | 'audit' | 'warn';
    threatLabOnSemanticTp: boolean;
    corpusEvalGate: boolean;
};
export declare function autopilotConfigPath(): string;
export declare function lastDigestPath(): string;
/** @deprecated use autopilotConfigPath() */
export declare const AUTOPILOT_CONFIG_PATH: string;
export declare function defaultAutopilotConfig(tenantId?: string): AutopilotConfig;
export declare function readAutopilotConfig(): AutopilotConfig | null;
export declare function writeAutopilotConfig(config: AutopilotConfig): void;
export type LastDigestMeta = {
    generatedAt: string;
    tenantId: string;
    healthPath?: string;
    securityPath?: string;
};
export declare function writeLastDigestMeta(meta: LastDigestMeta): void;
export declare function readLastDigestMeta(): LastDigestMeta | null;
//# sourceMappingURL=autopilot-config.d.ts.map