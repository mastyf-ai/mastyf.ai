import { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface CollusionAlert {
    alertId: string;
    pattern: 'recon_then_exploit' | 'coordinated_exfil' | 'token_share';
    agents: string[];
    tools: string[];
    confidence: number;
    timestamp: string;
    description: string;
}
export declare class CollusionDetector {
    private readonly store?;
    private sessions;
    private tokenMap;
    private alerts;
    constructor(store?: IndustryStandardStore | undefined);
    record(agentId: string, serverName: string, toolName: string, opts?: {
        sessionId?: string;
        tokenHint?: string;
        blocked?: boolean;
    }): CollusionAlert | null;
    private graphFromEvents;
    private detectReconThenExploit;
    private detectCoordinatedExfil;
    private detectTokenShare;
    getAlerts(): CollusionAlert[];
}
//# sourceMappingURL=collusion-watch.d.ts.map