import type { McpServerConfig } from '../../types.js';
export interface HardeningRecommendation {
    category: 'transport' | 'auth' | 'secrets' | 'tools' | 'policy';
    severity: 'critical' | 'high' | 'medium' | 'low';
    finding: string;
    recommendation: string;
    oneClickFix?: string;
    automatic: boolean;
}
export interface HardeningReport {
    serverName: string;
    score: number;
    grade: string;
    recommendations: HardeningRecommendation[];
    hardenedConfig?: string;
}
export declare class ConfigHardener {
    analyze(server: McpServerConfig): HardeningReport;
}
//# sourceMappingURL=hardening-advisor.d.ts.map