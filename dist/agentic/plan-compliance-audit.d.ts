export interface ComplianceCheck {
    id: string;
    passed: boolean;
    detail: string;
    weight: number;
}
export interface ModuleCompliance {
    id: string;
    name: string;
    score: number;
    checks: ComplianceCheck[];
}
export interface PlanComplianceReport {
    overallScore: number;
    productionReady: boolean;
    modules: ModuleCompliance[];
    generatedAt: string;
    summary: string;
}
export declare function runPlanComplianceAudit(): Promise<PlanComplianceReport>;
//# sourceMappingURL=plan-compliance-audit.d.ts.map