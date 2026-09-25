import type { ApprovalGate } from '../core.js';
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface IncidentAction {
    step: number;
    action: string;
    description: string;
    auto: boolean;
}
export interface IncidentReport {
    id: string;
    timestamp: string;
    trigger: string;
    source: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    actions: {
        step: number;
        action: string;
        executed: boolean;
        result: string;
        approvalId?: string;
    }[];
    summary: string;
    forensicSnapshot?: {
        toolSchemas: number;
        recentCalls: number;
        configHash: string;
    };
}
export declare class IncidentPlaybookRunner {
    private readonly approvalGate?;
    private readonly store?;
    private reports;
    private isolatedAgents;
    constructor(approvalGate?: ApprovalGate | undefined, store?: IndustryStandardStore | undefined);
    run(trigger: string, source: string, severity: IncidentReport['severity'], playbookKey: string, context?: {
        agentId?: string;
        toolSchemas?: number;
        recentCalls?: number;
    }): IncidentReport;
    private sendWebhook;
    private requestWebhook;
    private requestIsolation;
    isolateAgent(agentId: string): string;
    isAgentIsolated(agentId: string): boolean;
    getReports(): IncidentReport[];
}
//# sourceMappingURL=playbook-runner.d.ts.map