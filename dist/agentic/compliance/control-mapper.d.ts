/**
 * Compliance Control Mapper — maps MCP Mastyf AI policy rules and blocked incidents
 * to compliance framework controls (SOC 2, HIPAA, PCI-DSS, FedRAMP, ISO 27001).
 *
 * Provides real-time compliance posture scoring and gap analysis.
 */
export type ComplianceFramework = 'soc2' | 'hipaa' | 'pci-dss' | 'fedramp' | 'iso27001';
export interface ControlMapping {
    controlId: string;
    framework: ComplianceFramework;
    controlName: string;
    description: string;
    /** How this control is satisfied by Mastyf AI policies */
    satisfiedBy: string[];
    /** Whether this control is currently satisfied */
    satisfied: boolean;
    /** Gap description if not satisfied */
    gap?: string;
    /** Recommended policy to create */
    recommendedPolicy?: string;
}
export interface CompliancePosture {
    framework: ComplianceFramework;
    frameworkName: string;
    totalControls: number;
    satisfiedControls: number;
    partialControls: number;
    unsatisfiedControls: number;
    postureScore: number;
    controls: ControlMapping[];
    /** Critical gaps that need immediate attention */
    criticalGaps: ControlMapping[];
    /** Summary for auditors */
    summary: string;
}
export declare class ControlMapper {
    /**
     * Evaluate compliance posture for a given framework.
     */
    evaluate(framework: ComplianceFramework, activePolicies: string[], // List of active policy rule names
    blockedIncidents: string[]): CompliancePosture;
    /**
     * Evaluate a single compliance control against active policies.
     */
    private evaluateControl;
    /**
     * Generate a recommended policy to satisfy a compliance gap.
     */
    private generateRecommendedPolicy;
    /**
     * Get the control definitions for a compliance framework.
     */
    private getFrameworkControls;
    private getFrameworkName;
    private buildSummary;
}
//# sourceMappingURL=control-mapper.d.ts.map