import type { WrapClient } from '../wrap/client-wrap.js';
export declare function runAutopilotInit(opts: {
    client: WrapClient;
    configPath?: string;
    projectRoot: string;
    apply: boolean;
    tenantId?: string;
}): Promise<void>;
export declare function runAutopilotStatus(historyDbAttached?: boolean): Promise<void>;
export declare function runAutopilotStart(opts: {
    projectRoot: string;
    config?: string;
    policy?: string;
}): void;
//# sourceMappingURL=autopilot.d.ts.map