export declare function runRoadmapFleetGraphTrain(opts: {
    output: string;
    db?: string;
}): {
    w1: number[];
    w2: number[];
};
export declare function runRoadmapFederatedExport(opts: {
    output?: string;
    db?: string;
}): Promise<unknown>;
export declare function runRoadmapFederatedImport(opts: {
    input: string;
    db?: string;
}): void;
export declare function runRoadmapObservatorySync(opts: {
    db?: string;
}): Promise<{
    cloud: {
        ingested: number;
        cloudAvailable: boolean;
    };
    mesh: number;
    published: boolean;
}>;
export declare function runRoadmapReputationSync(opts: {
    db?: string;
}): Promise<number>;
export declare function runRoadmapPlanComplianceAudit(): Promise<import('../agentic/plan-compliance-audit.js').PlanComplianceReport>;
//# sourceMappingURL=roadmap-cmd.d.ts.map