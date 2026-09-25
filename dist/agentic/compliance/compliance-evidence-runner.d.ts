import { type ComplianceFramework, type CompliancePosture } from './control-mapper.js';
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { IDatabase } from '../../database/database-interface.js';
export interface ComplianceEvidenceBundle {
    framework: ComplianceFramework;
    posture: CompliancePosture;
    policyPath: string;
    policySignals: Array<{
        name: string;
        description?: string;
        action?: string;
        enabled: boolean;
    }>;
    incidentSignals: string[];
    auditCounts: {
        totalCalls: number;
        blockedCalls: number;
        servers: string[];
        byServer: Array<{
            serverName: string;
            totalCalls: number;
            blockedCalls: number;
        }>;
        securityScans: Array<{
            serverName: string;
            score: number;
            cveCount: number;
            recommendations: string[];
        }>;
        recentBlocked: Array<{
            serverName: string;
            toolName: string;
            blockRule?: string;
            blockReason?: string;
            timestamp: string;
            argumentSnippet?: string;
        }>;
    };
    generatedAt: string;
}
export declare class ComplianceEvidenceRunner {
    private readonly db;
    private readonly store?;
    private mapper;
    constructor(db: IDatabase, store?: IndustryStandardStore | undefined);
    run(framework: ComplianceFramework, policyPath?: string): Promise<ComplianceEvidenceBundle>;
}
//# sourceMappingURL=compliance-evidence-runner.d.ts.map