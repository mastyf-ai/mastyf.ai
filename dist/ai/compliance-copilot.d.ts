export type ControlMapping = {
    controlId: string;
    framework: 'NIST-CSF' | 'SOC2' | 'CIS';
    title: string;
    evidenceRules: string[];
    eventCount: number;
    sampleRecordIds: string[];
};
export type ComplianceReport = {
    generatedAt: string;
    windowDays: number;
    totalEvents: number;
    blockedCount: number;
    semanticFlagCount: number;
    controlMappings: ControlMapping[];
    topAttackClasses: Array<{
        category: string;
        count: number;
    }>;
    briefing?: string;
    exportFormats: {
        markdown: string;
        json: string;
    };
};
export declare function formatComplianceMarkdown(report: ComplianceReport): string;
export declare function generateComplianceReport(opts?: {
    tenantId?: string;
    windowDays?: number;
    useLlm?: boolean;
}): Promise<ComplianceReport>;
//# sourceMappingURL=compliance-copilot.d.ts.map